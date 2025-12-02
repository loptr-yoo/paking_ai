import { GoogleGenAI, Type } from "@google/genai";
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

// Internal helper to run the fix operation
const runFixOperation = async (layout: ParkingLayout, violations: ConstraintViolation[], ai: GoogleGenAI): Promise<ParkingLayout> => {
  const prompt = `
    Fix the following spatial violations in the parking layout.
    
    Current Layout Elements: ${JSON.stringify(layout.elements.map(e => ({id: e.id, type: e.type, x: e.x, y: e.y, w: e.width, h: e.height, r: e.rotation})))}
    
    Violations: ${JSON.stringify(violations)}
    
    INSTRUCTIONS:
    1. Modify x, y, width, height, or rotation to resolve the violations.
    2. DO NOT delete 'wall' or 'road' unless absolutely necessary.
    3. If 'safe_exit' is NOT touching a 'staircase', MOVE it to be adjacent to one.
    4. If 'parking_space' is parallel to road, ROTATE it 90 degrees.
    5. If an item is inside a road intersection, DELETE it or MOVE it away.
    6. Ensure the outer perimeter (0,0 to width,height) is enclosed by 'wall' elements.
    7. If 'charging_station' count is low, convert some 'parking_space' groups to 'charging_station'.
    8. If 'driving_lane' is excessively wide, make it narrower (approx 40-60 width).
    9. Ensure there is at least 1 'entrance' and 1 'exit'.
    10. IMPORTANT: Entrances and Exits MUST be on DIFFERENT sides of the perimeter wall. If they are on the same side, MOVE one of them to an opposite or adjacent wall.
    11. DO NOT generate 'building' elements.
    12. **PILLARS**: Pillars MUST NOT overlap 'driving_lane' or 'parking_space'. They CAN overlap 'wall' or be on 'ground'. If overlapping road/parking, MOVE them.
    
    Return the FULL updated JSON layout.
  `;

  const response = await ai.models.generateContent({
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
                 type: { type: Type.STRING },
                 x: { type: Type.NUMBER },
                 y: { type: Type.NUMBER },
                 width: { type: Type.NUMBER },
                 height: { type: Type.NUMBER },
                 rotation: { type: Type.NUMBER },
                 label: { type: Type.STRING },
               },
               required: ["id", "type", "x", "y", "width", "height"],
            },
          },
        },
      },
    }
  });
  
  return JSON.parse(response.text || "{}") as ParkingLayout;
};

// Internal helper loop
const ensureValidLayout = async (layout: ParkingLayout, ai: GoogleGenAI, onLog?: (msg: string) => void): Promise<ParkingLayout> => {
  let currentLayout = layout;
  const MAX_ITERATIONS = 5; 

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const violations = validateLayout(currentLayout);
    
    // Check Stop Condition 1: Fewer than 4 violations
    if (violations.length < 4) {
        if (onLog) onLog(`Auto-fix stopped: Violation count (${violations.length}) is acceptable (<4).`);
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
    
    if (onLog) onLog(`Auto-fixing iteration ${i+1}/${MAX_ITERATIONS} with ${violations.length} violations...`);
    
    try {
        currentLayout = await runFixOperation(currentLayout, violations, ai);
    } catch (e) {
        console.warn("Auto-fix pass failed", e);
        if (onLog) onLog("Auto-fix pass failed, stopping.");
        break;
    }
  }
  
  if (onLog) onLog("Final validation check complete.");
  return currentLayout;
};

export const generateParkingLayout = async (description: string, onLog?: (msg: string) => void): Promise<ParkingLayout> => {
  const apiKey = getApiKey();
  if (!apiKey) {
      console.error("API Key not found in environment.");
      return fallbackLayout;
  }

  try {
    if (onLog) onLog("Initializing Gemini 3 Pro...");
    const ai = new GoogleGenAI({ apiKey });
    
    if (onLog) onLog("Generating initial layout structure...");
    
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `Generate a JSON underground parking layout (0,0 at top-left) for: "${description}".
      
      CRITICAL REQUIREMENTS:
      1. **High Road Density**: 'driving_lane' elements MUST occupy the majority of the map, but individual lanes should not be excessively wide (keep width approx 40-60 units).
      2. **Perimeter Wall**: There MUST be 'wall' elements enclosing the ENTIRE boundary of the canvas (0,0 to width,height).
      3. **Parking Orientation**: PERPENDICULAR to the road (Back-in).
      4. **Parking Count**: Generate AT LEAST 40 'parking_space' elements.
      5. **No Buildings**: Do NOT use 'building' elements. 'staircase' and 'elevator' should come directly from ground/wall context.
      6. **Connectivity**: Include at least 1 'entrance' and 1 'exit'.
      7. **Separation**: Entrances and Exits MUST be placed on DIFFERENT sides of the layout (e.g. Entrance Left, Exit Right). Do NOT put them on the same wall.
      8. **Pillars**: Place 'pillar' elements for structural support, but they MUST NOT be inside 'driving_lane' or 'parking_space'. They can be on 'ground' or inside 'wall'.
      
      Use these types: ${Object.values(ElementType).join(', ')}.
      
      Output JSON using SHORT keys to save space: 
      t=type, x=x, y=y, w=width, h=height, r=rotation, l=label
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
                  t: { type: Type.STRING }, // Short key for type
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  w: { type: Type.NUMBER }, // Short key for width
                  h: { type: Type.NUMBER }, // Short key for height
                  r: { type: Type.NUMBER }, // Short key for rotation
                  l: { type: Type.STRING }, // Short key for label
                },
                required: ["id", "t", "x", "y", "w", "h"],
              },
            },
          },
          required: ["width", "height", "elements"],
        },
      },
    });
    
    if (onLog) onLog("Parsing generated layout...");
    const rawData = JSON.parse(response.text || "{}");
    
    let layout: ParkingLayout = {
        width: rawData.width,
        height: rawData.height,
        elements: (rawData.elements || []).map((e: any) => ({
            id: e.id,
            type: e.t,
            x: e.x,
            y: e.y,
            width: e.w,
            height: e.h,
            rotation: e.r || 0,
            label: e.l
        }))
    };

    if (onLog) onLog("Starting auto-validation loop...");
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
    if (onLog) onLog("Initializing augmentation...");
    const ai = new GoogleGenAI({ apiKey });
    
    const simplified = currentLayout.elements.map(e => ({
       id: e.id, t: e.type, x: e.x, y: e.y, w: e.width, h: e.height
    }));

    if (onLog) onLog("Generating detailed semantic elements...");
    const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: `Analyze this parking layout and ADD missing logical elements.
        
        Current Elements: ${JSON.stringify(simplified)}
        Canvas Size: ${currentLayout.width}x${currentLayout.height}

        TASKS:
        1. **Charging Stations**: Count the total 'parking_space' items. Convert AT LEAST 25% of them to 'charging_station'. Preferably group them.
        2. **Max Parking**: Identify empty 'ground' areas (non-road) and FILL them with more 'parking_space' items (perpendicular to roads). Maximize density.
        3. **Guidance Signs**: Place 'guidance_sign' (arrow) at EVERY road intersection. 
           - **ROTATION LOGIC**: Calculate the angle from the sign's position to the nearest 'exit'. Set 'rotation' to this angle (in degrees). 0 = East/Right.
        4. **Pedestrian Paths**: Add 'pedestrian_path' (zebra crossing) across roads to connect parking blocks.
           - Visual correction: The prompt creates the bounding box, renderer draws stripes. Ensure the box spans the road width.
        5. **Ramps**: Add 'slope' adjacent to every 'entrance' and 'exit'.
        6. **Safe Exits**: Add 'safe_exit' specifically ADJACENT to every 'staircase'. Do NOT place on walls unless a staircase is there.
        7. **Ground Lines**: Add 'ground_line' (dashed center lines). One per road segment. No intersection overlap.
        8. **Perimeter**: If the canvas edge is open, add 'wall' elements to close it.
        9. **Validation**: Ensure at least 1 'entrance' and 1 'exit' exist.
        10. **Separation**: Verify that Entrances and Exits are on DIFFERENT sides of the layout. If not, MOVE one.
        11. **No Buildings**: Do not generate 'building' elements.
        12. **PILLARS**: Ensure NO 'pillar' is overlapping a 'driving_lane' or 'parking_space'. If one is detected, MOVE it.

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
    });

    const rawData = JSON.parse(response.text || "{}");
    
    let layout: ParkingLayout = {
        width: rawData.width,
        height: rawData.height,
        elements: (rawData.elements || []).map((e: any) => ({
            id: e.id,
            type: e.t,
            x: e.x,
            y: e.y,
            width: e.w,
            height: e.h,
            rotation: e.r || 0,
            label: e.l
        }))
    };

    if (onLog) onLog("Validating augmented details...");
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
  return await runFixOperation(layout, violations, ai);
};