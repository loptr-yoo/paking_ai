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
  if (lower === 'ramp') return ElementType.RAMP; 
  if (lower === 'speed_bump') return ElementType.SPEED_BUMP; 
  if (lower === 'road') return ElementType.ROAD; 
  if (lower === 'pedestrian_path') return ElementType.SIDEWALK; 
  if (lower === 'ground_line') return ElementType.LANE_LINE;
  return lower;
};

// Helper to clean and parse JSON, with simple repair for truncation
const cleanAndParseJSON = (text: string): any => {
  let cleanText = text.replace(/```json\s*|```/g, "").trim();

  try {
    return JSON.parse(cleanText);
  } catch (e) {
    console.warn("JSON Parse failed. Attempting repair...");
    const stack: string[] = [];
    let inString = false;
    let isEscaped = false;

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
    if (inString) cleanText += '"';
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

/**
 * PROCEDURAL PARKING GENERATOR
 * Automatically fills ground areas with parking spaces based on geometry.
 * INCLUDES PROCEDURAL CHARGING STATION PLACEMENT
 */
const fillParkingAutomatically = (layout: ParkingLayout): ParkingLayout => {
  const newElements = [...layout.elements];
  const grounds = newElements.filter(e => e.type === ElementType.GROUND);
  
  // Clean up existing tiny/auto-gen parking spots & charging stations to regenerate them
  const cleanElements = newElements.filter(e => {
    if (e.type === ElementType.PARKING_SPACE) return false; // Remove all to regenerate strictly
    if (e.type === ElementType.CHARGING_STATION) return false; // Remove all to regenerate strictly
    return true;
  });

  const generatedSpots: LayoutElement[] = [];
  let spotCounter = 1000;
  let chargeCounter = 5000;

  grounds.forEach(ground => {
    // Check overlaps
    const hasObstacle = cleanElements.some(e => 
      (e.type === ElementType.WALL || e.type === ElementType.STAIRCASE || e.type === ElementType.ENTRANCE) &&
      e.x >= ground.x && e.x + e.width <= ground.x + ground.width &&
      e.y >= ground.y && e.y + e.height <= ground.y + ground.height
    );
    if (hasObstacle) return;

    const gW = ground.width;
    const gH = ground.height;
    const isHorizontalStrip = gW > gH;
    
    const longDim = isHorizontalStrip ? gW : gH;
    const shortDim = isHorizontalStrip ? gH : gW;

    const BUFFER = 2; 
    
    // STRICT DIMENSIONS (1:2 Ratio)
    // 12.5 width x 25 depth units
    const SPOT_WIDTH = 12.5; 
    const SPOT_DEPTH = 25; 

    // Determine layout strategy: Single vs Double
    // If we have enough depth (> 50 + buffers), go double row back-to-back
    let isDoubleRow = shortDim >= (SPOT_DEPTH * 2) + (BUFFER * 2);
    
    // If it's a very narrow strip (side ground), enforce Single Row even if logic says otherwise
    // Assuming standard side grounds are ~30-40 units
    if (shortDim < 50) isDoubleRow = false;

    // Calculate how many spots fit in the long dimension
    const numSpots = Math.floor((longDim - (BUFFER * 2)) / SPOT_WIDTH);

    // GENERATE
    for (let r = 0; r < (isDoubleRow ? 2 : 1); r++) {
      for (let i = 0; i < numSpots; i++) {
        let x, y, w, h;

        // PARKING SPOT COORDINATES
        if (isHorizontalStrip) {
          // Horizontal Strip -> Vertical Spots
          w = SPOT_WIDTH;
          h = SPOT_DEPTH;
          x = ground.x + BUFFER + (i * SPOT_WIDTH);
          // Row 0: Top (Back is Up/Top), Row 1: Bottom (Back is Down/Bottom)
          y = (r === 0) 
            ? ground.y + BUFFER 
            : ground.y + gH - SPOT_DEPTH - BUFFER;
        } else {
          // Vertical Strip -> Horizontal Spots
          w = SPOT_DEPTH;
          h = SPOT_WIDTH;
          // Row 0: Left (Back is Left), Row 1: Right (Back is Right)
          x = (r === 0) 
             ? ground.x + BUFFER 
             : ground.x + gW - SPOT_DEPTH - BUFFER;
          y = ground.y + BUFFER + (i * SPOT_WIDTH);
        }

        const spotId = `gen_p_${spotCounter++}`;
        generatedSpots.push({
          id: spotId,
          type: ElementType.PARKING_SPACE,
          x, y, width: w, height: h,
          rotation: 0
        });

        // CHARGING STATION GENERATION
        // Rule: Every other spot (odd/even check), placed at the "butt" (back)
        if (i % 2 === 0) {
            let cx, cy, cw, ch;
            const STATION_SIZE = 5; // Small block
            const STATION_THICKNESS = 4;

            if (isHorizontalStrip) {
                // Vertical Spot
                cw = 6; ch = 4;
                cx = x + (w - cw) / 2; // Center horizontally on spot
                // Row 0 (Top): Butt is at Top (y) -> Station above y
                // Row 1 (Bottom): Butt is at Bottom (y+h) -> Station below y+h
                cy = (r === 0) ? y - ch : y + h;
            } else {
                // Horizontal Spot
                cw = 4; ch = 6;
                cy = y + (h - ch) / 2; // Center vertically on spot
                // Row 0 (Left): Butt is Left (x) -> Station left of x
                // Row 1 (Right): Butt is Right (x+w) -> Station right of x+w
                cx = (r === 0) ? x - cw : x + w;
            }

            generatedSpots.push({
                id: `gen_ch_${chargeCounter++}`,
                type: ElementType.CHARGING_STATION,
                x: cx, y: cy, width: cw, height: ch,
                rotation: 0
            });
        }
      }
    }
  });

  return {
    ...layout,
    elements: [...cleanElements, ...generatedSpots]
  };
};

// Internal helper to run the fix operation
const runFixOperation = async (layout: ParkingLayout, violations: ConstraintViolation[], ai: GoogleGenAI, onLog?: (msg: string) => void): Promise<ParkingLayout> => {
  const prompt = `
    Fix the following spatial violations in the parking layout.
    
    Current Elements (Simplified): ${JSON.stringify(layout.elements.map(e => ({id: e.id, t: e.type, x: e.x, y: e.y, w: e.width, h: e.height, r: e.rotation})))}
    
    Violations (Top Priority): ${JSON.stringify(violations)}
    
    INSTRUCTIONS (PRIORITIZE REPAIR OVER DELETE):
    1. **CONDITIONAL DELETE (>= 40% OVERLAP)**: 
       - If a 'parking_space' overlaps a solid object (wall, road, pillar) by **40% OR MORE** of its area, DELETE IT immediately.
       - If overlap is < 40%, you MUST try to MOVE (translate) or RESIZE (shrink slightly) the parking space to fit first. Only delete if moving creates new conflicts.
    2. **Pedestrian Path Logic**: 
       - Paths MUST be on roads. If a 'pedestrian_path' is floating on 'ground' or 'parking_space', DELETE it.
       - Ensure orientation matches road (Horizontal path on Vertical road).
    3. **Safe Exits**: If 'safe_exit' is on road/parking, MOVE it to empty ground near stairs.
    4. **Orientation**: If 'parking_space' is parallel to road, ROTATE it 90 degrees.
    5. **Ramps**: If 'slope' overlaps road, RESIZE/MOVE to be strictly ADJACENT.
    6. **Pillars**: If a pillar blocks a road, MOVE the pillar.
    7. **Buffer**: Ensure 'parking_space' grids are at least 5 units away from 'driving_lane' edges.
    8. **Charging Stations**: Ensure they are attached to parking spaces and do not block roads.
    
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
  let stableSnapshot = JSON.parse(JSON.stringify(layout)); 
  let previousViolationsCount = validateLayout(layout).length;
  
  let consecutiveRegressionCount = 0;
  let hasReverted = false;

  const MAX_ITERATIONS = 5; 
  const MAX_VIOLATIONS_TO_SEND = 100;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // 1. Validate
    const violations = validateLayout(currentLayout);
    const currentViolationsCount = violations.length;

    if (currentViolationsCount < 4) {
        if (onLog) onLog(`Auto-fix stopped: Violation count (${currentViolationsCount}) is acceptable (<4).`);
        break;
    }

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
            if (hasReverted) {
                if (onLog) onLog(`❌ Persistent regression after revert. Giving up and restoring last stable snapshot.`);
                currentLayout = stableSnapshot;
                break;
            }

            if (onLog) onLog(`⚠️ Double regression detected. Reverting to stable snapshot and retrying...`);
            currentLayout = stableSnapshot;
            previousViolationsCount = validateLayout(stableSnapshot).length;
            consecutiveRegressionCount = 0;
            hasReverted = true;
            continue; 
        }
    } else {
        consecutiveRegressionCount = 0;
        stableSnapshot = JSON.parse(JSON.stringify(currentLayout)); 
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
      REQUIRED TYPES: 'wall', 'pillar', 'driving_lane' (road), 'ground' (for parking areas), 'ramp', 'entrance', 'exit', 'staircase', 'elevator'.
      DO NOT GENERATE: 'lane_line', 'guidance_sign', 'speed_bump', 'charging_station', 'pedestrian_path', 'parking_space' (will be auto-filled).
      
      CRITICAL RULES:
      1. **High Road Density**: Roads must connect entrances/exits effectively.
      2. **Perimeter Wall**: Enclose the ENTIRE boundary.
      3. **SAFETY BUFFERS**: Leave a 5-unit empty buffer between 'driving_lane' and 'ground' zones.
      4. **Ground Generation**: Define large rectangular 'ground' areas clearly separated from roads. These will be filled with parking spots programmatically.
      5. **Connectivity**: At least 1 Entrance and 1 Exit on DIFFERENT sides.
      6. **Layout Strategy**: Place Main Roads first, then PACK the remaining areas with large Ground rectangles.
      
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
        1. **Guidance Signs**: 'guidance_sign' (arrow) at EVERY intersection. Point to nearest EXIT.
        2. **Pedestrian Paths**: 'pedestrian_path' (zebra crossing) across roads.
           - **GEOMETRY & ORIENTATION**:
             - **CROSSING VERTICAL ROAD**: Path MUST be HORIZONTAL (Width approx = Road Width, Height approx 15-20).
             - **CROSSING HORIZONTAL ROAD**: Path MUST be VERTICAL (Height approx = Road Height, Width approx 15-20).
           - **Placement**: MUST be fully contained within the 'driving_lane' boundary. Connect parking clusters.
        3. **Ground Lines**: 'ground_line' (dashed center lines) on roads. One per segment.
        4. **Speed Bumps**: 'speed_bump' (small, thin) perpendicular to road flow.
        5. **Safe Exits**: 'safe_exit' adjacent to 'staircase' on GROUND only.
        
        NOTE: Do NOT generate 'parking_space' or 'charging_station' manually. They will be auto-filled by the system.
        
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

    if (onLog) onLog("Auto-filling parking spaces & charging stations...");
    const filledLayout = fillParkingAutomatically(layout);

    if (onLog) onLog("Validating and Fixing details...");
    return await ensureValidLayout(filledLayout, ai, onLog);

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