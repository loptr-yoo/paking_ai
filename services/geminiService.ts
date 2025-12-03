import { GoogleGenAI, Type, Schema } from "@google/genai";
import { ParkingLayout, ElementType, LayoutElement, ConstraintViolation } from "../types";
import { validateLayout } from "../utils/geometry";

const fallbackLayout: ParkingLayout = {
  width: 800,
  height: 600,
  elements: []
};

const getApiKey = () => {
  try {
    if (typeof process !== 'undefined' && process.env) {
      return process.env.API_KEY;
    }
  } catch (e) {
    console.warn("Could not access process.env");
  }
  return undefined;
};

// Helper for retry logic
async function generateWithFallback(
  ai: GoogleGenAI, 
  params: { model: string, contents: string, config: any }, 
  onLog?: (msg: string) => void
) {
  try {
    return await ai.models.generateContent(params);
  } catch (error) {
    if (params.model === "gemini-3-pro-preview") {
      if (onLog) onLog("Gemini 3 Pro encountered an error. Falling back to Gemini 2.5 Flash for stability...");
      console.warn("Gemini 3 Pro failed, falling back to Flash:", error);
      return await ai.models.generateContent({
        ...params,
        model: "gemini-2.5-flash"
      });
    }
    throw error;
  }
}

// Helper to normalize AI output types to internal Enum values
const normalizeType = (t: string): string => {
  const lower = t.toLowerCase();
  if (lower === 'ramp') return ElementType.RAMP; // Maps to 'slope'
  if (lower === 'speed_bump') return ElementType.SPEED_BUMP; // Maps to 'deceleration_zone'
  if (lower === 'road') return ElementType.ROAD; // Maps to 'driving_lane'
  if (lower === 'pedestrian_path') return ElementType.SIDEWALK; 
  if (lower === 'ground_line') return ElementType.LANE_LINE;
  return lower;
};

// Helper to clean and parse JSON, with simple repair for truncation
const cleanAndParseJSON = (text: string): any => {
  // 1. Remove Markdown code blocks
  let cleanText = text.replace(/```json\s*|```/g, "").trim();

  try {
    return JSON.parse(cleanText);
  } catch (e) {
    // 2. Attempt simple repair for truncation
    console.warn("JSON Parse failed. Attempting repair...");
    
    // Very basic repair: check if it ended abruptly and close open structures
    const stack: string[] = [];
    let inString = false;
    let isEscaped = false;

    // Re-scan to build stack
    for (const char of cleanText) {
        if (inString) {
            if (char === '"' && !isEscaped) {
                inString = false;
            } else if (char === '\\') {
                isEscaped = !isEscaped;
            } else {
                isEscaped = false;
            }
        } else {
            if (char === '"') {
                inString = true;
            } else if (char === '{') {
                stack.push('}');
            } else if (char === '[') {
                stack.push(']');
            } else if (char === '}') {
                if (stack[stack.length - 1] === '}') stack.pop();
            } else if (char === ']') {
                if (stack[stack.length - 1] === ']') stack.pop();
            }
        }
    }

    // Close open string
    if (inString) cleanText += '"';
    // Close open structures (reverse order)
    while (stack.length > 0) {
        cleanText += stack.pop();
    }

    try {
        return JSON.parse(cleanText);
    } catch (e2) {
        throw new Error("JSON Parse failed even after repair attempt: " + (e as Error).message);
    }
  }
};

// Internal helper to run the fix operation
const runFixOperation = async (layout: ParkingLayout, violations: ConstraintViolation[], ai: GoogleGenAI, onLog?: (msg: string) => void): Promise<ParkingLayout> => {
  const prompt = `
    Fix the following spatial violations in the parking layout.
    
    Current Elements (Simplified): ${JSON.stringify(layout.elements.map(e => ({id: e.id, t: e.type, x: e.x, y: e.y, w: e.width, h: e.height, r: e.rotation})))}
    
    Violations (Top Priority): ${JSON.stringify(violations)}
    
    INSTRUCTIONS (AGGRESSIVE FIXING):
    1. **DELETE IS BETTER THAN MOVE**: 
       - If a 'parking_space' overlaps a 'wall', 'road', or 'pillar' by ANY amount, DELETE IT immediately. 
       - Do not try to micro-adjust coordinates for overlaps, it is inefficient. DELETE is the correct action.
    2. **Intersections**: If 'speed_bump', 'lane_line', or 'pedestrian_path' is inside an intersection, DELETE it.
    3. **Safe Exits**: If 'safe_exit' is not valid (e.g. on road), MOVE it to valid empty ground near stairs. If no space, DELETE it.
    4. **Orientation**: If 'parking_space' is parallel to road, ROTATE it 90 degrees.
    5. **Ramps**: If 'slope' overlaps road, RESIZE/MOVE to be strictly ADJACENT.
    6. **Pillars**: If a pillar blocks a road, MOVE the pillar.
    7. **Buffer**: Ensure 'parking_space' grids are at least 5 units away from 'driving_lane' edges.
    
    GENERAL RULES:
    - DO NOT delete 'wall' or 'road' unless absolutely necessary for connectivity.
    - Ensure 'entrance' and 'exit' exist.
    - DO NOT generate 'building'.
    
    Return the FULL updated JSON layout.
  `;

  const response = await generateWithFallback(ai, {
    model: "gemini-3-pro-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          width: { type: Type.NUMBER },
          height: { type: Type.NUMBER },
          elements: {
            type: Type.ARRAY,
            items: {
               type: Type.OBJECT,
               properties: {
                 id: { type: Type.STRING },
                 t: { type: Type.STRING },
                 x: { type: Type.NUMBER },
                 y: { type: Type.NUMBER },
                 w: { type: Type.NUMBER },
                 h: { type: Type.NUMBER },
                 r: { type: Type.NUMBER },
                 l: { type: Type.STRING },
               },
               required: ["id", "t", "x", "y", "w", "h"],
            },
          },
        },
      },
    }
  }, onLog);
  
  const rawData = cleanAndParseJSON(response.text || "{}");
  return {
      width: rawData.width || layout.width,
      height: rawData.height || layout.height,
      elements: (rawData.elements || []).map((e: any) => ({
          id: e.id,
          type: normalizeType(e.t),
          x: e.x,
          y: e.y,
          width: e.w,
          height: e.h,
          rotation: e.r || 0,
          label: e.l
      }))
  };
};

// Internal helper loop
const ensureValidLayout = async (layout: ParkingLayout, ai: GoogleGenAI, onLog?: (msg: string) => void): Promise<ParkingLayout> => {
  let currentLayout = layout;
  let stableSnapshot = JSON.parse(JSON.stringify(layout)); // Snapshot of the last "good" (or least bad) state
  let previousViolationsCount = validateLayout(layout).length;
  
  let consecutiveRegressionCount = 0;
  let hasReverted = false;

  const MAX_ITERATIONS = 5; 
  // INCREASED BATCH SIZE: Send up to 100 violations (Fix All / 4/5ths)
  const MAX_VIOLATIONS_TO_SEND = 100;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // 1. Validate
    const violations = validateLayout(currentLayout);
    const currentViolationsCount = violations.length;

    // Check Stop Condition 1: Fewer than 4 violations
    if (currentViolationsCount < 4) {
        if (onLog) onLog(`Auto-fix stopped: Violation count (${currentViolationsCount}) is acceptable (<4).`);
        break;
    }

    // Check Stop Condition 2: Remaining violations are ONLY related to Road vs Wall overlaps
    const isOnlyRoadWallIssues = violations.every(v => {
        if (v.type !== 'overlap') return false;
        const el1 = currentLayout.elements.find(e => e.id === v.elementId);
        const el2 = currentLayout.elements.find(e => e.id === v.targetId);
        if (!el1 || !el2) return false;
        const types = [el1.type, el2.type];
        return types.includes(ElementType.ROAD) && types.includes(ElementType.WALL);
    });

    if (isOnlyRoadWallIssues) {
        if (onLog) onLog(`Auto-fix stopped: Remaining violations are minor Road-Wall overlaps.`);
        break;
    }

    // --- REGRESSION LOGIC START ---
    if (currentViolationsCount > previousViolationsCount) {
        consecutiveRegressionCount++;
        if (onLog) onLog(`Regression detected: Violations increased from ${previousViolationsCount} to ${currentViolationsCount} (Streak: ${consecutiveRegressionCount})`);

        if (consecutiveRegressionCount >= 2) {
            // Double regression detected
            if (hasReverted) {
                // We already tried reverting once and it failed again. STOP to prevent infinite loop.
                if (onLog) onLog(`❌ Persistent regression after revert. Giving up and restoring last stable snapshot.`);
                currentLayout = stableSnapshot;
                break;
            }

            // First time hitting double regression: Revert to stable snapshot
            if (onLog) onLog(`⚠️ Double regression detected. Reverting to stable snapshot and retrying...`);
            currentLayout = stableSnapshot;
            previousViolationsCount = validateLayout(stableSnapshot).length;
            consecutiveRegressionCount = 0;
            hasReverted = true;
            continue; // Skip the fix step this loop, just reset state
        }
        // Single regression: Continue loop, hope AI fixes it next time. 
        // DO NOT update stableSnapshot.
    } else {
        // Improvement or same
        consecutiveRegressionCount = 0;
        stableSnapshot = JSON.parse(JSON.stringify(currentLayout)); // Update stable point
        previousViolationsCount = currentViolationsCount;
    }
    // --- REGRESSION LOGIC END ---

    const violationsToSend = violations.slice(0, MAX_VIOLATIONS_TO_SEND);
    
    if (onLog) onLog(`Auto-fixing iteration ${i+1}/${MAX_ITERATIONS}. Found ${currentViolationsCount} violations, fixing top ${violationsToSend.length} (Batch Limit: ${MAX_VIOLATIONS_TO_SEND})...`);
    
    try {
        const fixedLayout = await runFixOperation(currentLayout, violationsToSend, ai, onLog);
        currentLayout = fixedLayout;
    } catch (e) {
        console.warn("Auto-fix pass failed", e);
        if (onLog) onLog("Auto-fix pass failed (possibly timeout), stopping loop.");
        break;
    }
  }
  
  if (onLog) onLog("Final validation check complete.");
  return currentLayout;
};

export const generateParkingLayout = async (description: string, onLog?: (msg: string) => void): Promise<ParkingLayout> => {
  const apiKey = getApiKey();
  if (!apiKey) {
      console.error("API Key not found.");
      return fallbackLayout;
  }

  try {
    if (onLog) onLog("Initializing AI Service...");
    const ai = new GoogleGenAI({ apiKey });
    
    if (onLog) onLog("Generating STRUCTURAL layout (Coarse-grained)...");
    
    const response = await generateWithFallback(ai, {
      model: "gemini-3-pro-preview",
      contents: `Generate a COARSE-GRAINED JSON underground parking layout (0,0 at top-left) for: "${description}".
      
      SCOPE: Generate ONLY the structural foundation.
      REQUIRED TYPES: 'wall', 'pillar', 'driving_lane' (road), 'parking_space', 'ramp', 'entrance', 'exit', 'staircase', 'elevator'.
      DO NOT GENERATE: 'lane_line', 'guidance_sign', 'speed_bump', 'charging_station', 'pedestrian_path'.
      
      CRITICAL RULES:
      1. **High Road Density**: Roads must connect entrances/exits effectively.
      2. **Perimeter Wall**: Enclose the ENTIRE boundary.
      3. **SAFETY BUFFERS (MANDATORY)**: You MUST leave a 5-unit empty buffer between 'driving_lane' and 'parking_space' grids. Do not place parking spots directly touching the road edge line, leave a small gap.
      4. **SMART PARKING PLACEMENT (Topology Rules)**:
         - **Orientation**: MUST be Perpendicular (Back-in) to the road. NO Parallel parking.
         - **Side/Peripheral Ground**: Place a SINGLE row of 'parking_space' along the edge facing the 'driving_lane'.
         - **Island/Central Ground**: Place 'parking_space' rows on ALL 4 SIDES (Perimeter ring) facing outwards to the roads.
         - **Row Length**: Parking rows should occupy approx 80% (4/5) of the ground edge length. Center the row.
         - **Conflict Resolution**: 'parking_space' MUST NOT overlap 'pillar'. If a spot overlaps a pillar, DELETE that specific parking spot (preferred) or shift the pillar slightly.
      5. **Connectivity**: At least 1 Entrance and 1 Exit on DIFFERENT sides.
      6. **No Buildings**: Use ground/wall context for stairs/elevators.
      7. **Ramps/Slopes**: Must be ADJACENT to Entrances/Exits. Width MUST MATCH the entrance width. Do not place them on top of the road.
      8. **Pillars**: Structural support, usually near walls or grid intersections, NOT on roads.
      9. **Layout Strategy**: Place Main Roads first, then PACK the remaining areas with Parking grids.
      
      Output JSON using SHORT keys (t,x,y,w,h,r).
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            width: { type: Type.NUMBER },
            height: { type: Type.NUMBER },
            elements: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  t: { type: Type.STRING }, 
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  w: { type: Type.NUMBER },
                  h: { type: Type.NUMBER },
                  r: { type: Type.NUMBER },
                  l: { type: Type.STRING },
                },
                required: ["id", "t", "x", "y", "w", "h"],
              },
            },
          },
          required: ["width", "height", "elements"],
        },
      },
    }, onLog);
    
    if (onLog) onLog("Parsing generated structure...");
    const rawData = cleanAndParseJSON(response.text || "{}");
    
    let layout: ParkingLayout = {
        width: rawData.width,
        height: rawData.height,
        elements: (rawData.elements || []).map((e: any) => ({
            id: e.id,
            type: normalizeType(e.t),
            x: e.x,
            y: e.y,
            width: e.w,
            height: e.h,
            rotation: e.r || 0,
            label: e.l
        }))
    };

    if (onLog) onLog("Validating structure...");
    return await ensureValidLayout(layout, ai, onLog);
  } catch (error) {
    console.error("Gen failed:", error);
    if (onLog) onLog(`Error: ${error}`);
    return fallbackLayout;
  }
};

export const augmentLayoutWithRoads = async (currentLayout: ParkingLayout, onLog?: (msg: string) => void): Promise<ParkingLayout> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key required");

  try {
    if (onLog) onLog("Initializing Refinement...");
    const ai = new GoogleGenAI({ apiKey });
    
    const simplified = currentLayout.elements.map(e => ({
       id: e.id, t: e.type, x: e.x, y: e.y, w: e.width, h: e.height
    }));

    if (onLog) onLog("Generating DETAILED semantics (Fine-grained)...");
    const response = await generateWithFallback(ai, {
        model: "gemini-3-pro-preview",
        contents: `Analyze this parking structure and ADD Fine-Grained Semantic Details.
        
        Current Structure: ${JSON.stringify(simplified)}
        Canvas: ${currentLayout.width}x${currentLayout.height}

        TASKS (ADD THESE ELEMENTS):
        1. **BACKFILL PARKING**: Check for empty 'ground' areas. Apply the TOPOLOGY RULES:
           - **Side Ground**: Single row, perpendicular, 80% length.
           - **Island Ground**: Perimeter ring, perpendicular, 80% length.
           - **Buffer**: Maintain 5-unit gap from roads.
           - Delete any new spots that overlap existing 'pillar' or 'wall'.
        2. **Charging Stations**: Designate specific zones for 'charging_station'. Count >= Total Parking / 4.
        3. **Guidance Signs**: 'guidance_sign' (arrow) at EVERY intersection. **CRITICAL**: Calculate precise geometric angle from the sign's (x,y) to the nearest 'exit' (x,y). Set 'r' (rotation) so 0=East, 90=South, 180=West, 270=North.
        4. **Pedestrian Paths**: 'pedestrian_path' (zebra crossing) across roads connecting parking areas. OPTIMIZE placement for shortest path.
        5. **Ground Lines**: 'ground_line' (dashed center lines) on roads. One per segment. DO NOT place in intersections.
        6. **Speed Bumps**: 'speed_bump' (small, thin) near long straight roads. ONLY on driving lanes, NEVER in intersections.
        7. **Safe Exits**: 'safe_exit' MUST overlap GROUND only (NOT road, NOT parking, NOT wall) AND be adjacent to 'staircase'.
        8. **Fire Extinguishers**: 'fire_extinguisher' MUST overlap GROUND only (NOT road, NOT parking). Place near pillars or walls.
        
        CONSTRAINTS:
        - Do NOT move Walls or Roads significantly.
        - **Intersections**: Do NOT place 'speed_bump', 'lane_line', or 'pedestrian_path' inside the box where two roads intersect. Only 'guidance_sign' belongs there.
        - Ensure Pedestrian Paths have correct orientation (stripes perpendicular to path direction).

        Output JSON using SHORT keys: t, x, y, w, h, r, l.
        `,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                  width: { type: Type.NUMBER },
                  height: { type: Type.NUMBER },
                  elements: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        t: { type: Type.STRING },
                        x: { type: Type.NUMBER },
                        y: { type: Type.NUMBER },
                        w: { type: Type.NUMBER },
                        h: { type: Type.NUMBER },
                        r: { type: Type.NUMBER },
                        l: { type: Type.STRING },
                      },
                      required: ["id", "t", "x", "y", "w", "h"],
                    },
                  },
                },
                required: ["width", "height", "elements"],
              },
        }
    }, onLog);

    const rawData = cleanAndParseJSON(response.text || "{}");
    
    let layout: ParkingLayout = {
        width: rawData.width,
        height: rawData.height,
        elements: (rawData.elements || []).map((e: any) => ({
            id: e.id,
            type: normalizeType(e.t),
            x: e.x,
            y: e.y,
            width: e.w,
            height: e.h,
            rotation: e.r || 0,
            label: e.l
        }))
    };

    if (onLog) onLog("Validating details...");
    return await ensureValidLayout(layout, ai, onLog);

  } catch (error) {
    console.error("Augment failed:", error);
    if (onLog) onLog(`Error: ${error}`);
    return currentLayout;
  }
};

export const fixLayoutViolations = async (layout: ParkingLayout, violations: ConstraintViolation[]): Promise<ParkingLayout> => {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("API Key required");
    const ai = new GoogleGenAI({ apiKey });
    // Also use the larger batch size for manual fixes if ever called directly
    return await runFixOperation(layout, violations.slice(0, 100), ai);
};
