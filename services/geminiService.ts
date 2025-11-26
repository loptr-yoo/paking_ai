import { GoogleGenAI, Type } from "@google/genai";
import { ParkingLayout, ElementType, LayoutElement, ConstraintViolation } from "../types";

const fallbackLayout: ParkingLayout = {
  width: 800,
  height: 600,
  elements: []
};

const getApiKey = () => {
  try {
    // Safely check for process.env in browser environments
    if (typeof process !== 'undefined' && process.env) {
      return process.env.API_KEY;
    }
  } catch (e) {
    console.warn("Could not access process.env");
  }
  return undefined;
};

export const generateParkingLayout = async (description: string): Promise<ParkingLayout> => {
  const apiKey = getApiKey();
  if (!apiKey) {
      console.error("API Key not found in environment.");
      return fallbackLayout;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Generate a JSON underground parking layout (0,0 at top-left) for: "${description}".
      
      CRITICAL REQUIREMENTS:
      1. **High Road Density**: 'driving_lane' elements MUST occupy the majority of the map. Minimize empty 'ground'.
      2. **Parking Count**: Generate AT LEAST 40 'parking_space' elements.
      3. **Building Logic**: 'staircase' and 'elevator' MUST be placed ADJACENT to 'driving_lane' (not floating in middle of nowhere).
      4. **Building Size**: 'staircase' and 'elevator' dimensions should be approximately 2x larger than a standard 'parking_space'.
      5. **Road Width**: Ensure roads are wide (~50-80 units).
      
      Use these types: ${Object.values(ElementType).join(', ')}.
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
          required: ["width", "height", "elements"],
        },
      },
    });
    return JSON.parse(response.text || "{}") as ParkingLayout;
  } catch (error) {
    console.error("Gen failed:", error);
    return fallbackLayout;
  }
};

export const augmentLayoutWithRoads = async (currentLayout: ParkingLayout): Promise<LayoutElement[]> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key required");

  // Simplify for token limit
  const simplified = currentLayout.elements.map(e => ({
    id: e.id, type: e.type, x: e.x, y: e.y, w: e.width, h: e.height
  }));

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `
        Analyze this parking layout (${currentLayout.width}x${currentLayout.height}).
        Elements: ${JSON.stringify(simplified)}.
        
        TASK:
        1. **FILL EMPTY GROUND WITH PARKING**: Identify any 'ground' areas (empty spaces) or areas containing ONLY 'pillar' elements. You MUST fill these areas uniformly with 'parking_space' elements to maximize capacity. Do not leave large empty gaps.
        2. **ADD ROADS**: Add 'driving_lane' to connect everything if missing.
        3. **ADD MARKINGS**: Add 'ground_line' (Yellow dashed lines) inside driving lanes.
        4. **ADD PATHS**: Add 'pedestrian_path' (white crossing lines).
        5. **ADD DETAILS**: Add 'guidance_sign', 'deceleration_zone', 'safe_exit'.
        
        CRITICAL RULES FOR LINES & PATHS:
        - **Ground Line Orientation**: 
          - Horizontal Road -> Horizontal Line.
          - Vertical Road -> Vertical Line.
        - **Intersections**: 
          - Do NOT place 'ground_line' in the intersection area where two driving lanes cross.
        - **Pedestrian Path Sizing**:
          - Must be placed ON TOP of a 'driving_lane'.
          - **LENGTH RULE**: The dimension of the path parallel to the road (its thickness) MUST be exactly **1/10th (10%)** of the length of the nearest 'ground_line' (road segment).
          - Example: If the road/line is 200 units long, the pedestrian path should be 20 units thick along that axis.
          - The stripes of the path MUST BE PARALLEL to the nearest 'ground_line'.
        
        General Rules:
        - 'staircase'/'elevator' on GROUND only (or strictly adjacent to road, not ON road).
        - 'safe_exit' must touch a Wall.
        - Do not return existing elements.
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              type: { type: Type.STRING, enum: Object.values(ElementType) },
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
    });

    return JSON.parse(response.text || "[]") as LayoutElement[];

  } catch (error) {
    console.error("Augment failed:", error);
    return [];
  }
};

export const fixLayoutViolations = async (currentLayout: ParkingLayout, violations: ConstraintViolation[]): Promise<ParkingLayout> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key required");

  const simplified = currentLayout.elements.map(e => ({
    id: e.id, type: e.type, x: e.x, y: e.y, w: e.width, h: e.height
  }));

  const violationText = violations.map(v => `${v.type} error on ${v.elementId}: ${v.message}`).join('\n');

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `
        Fix these layout violations for a parking lot (${currentLayout.width}x${currentLayout.height}).
        
        Violations:
        ${violationText}
        
        Current Elements:
        ${JSON.stringify(simplified)}
        
        Logic for Fixes:
        - **STRATEGY**: First try to SCALE (Resize) or TRANSLATE (Move) the element to a valid location.
        - **DELETE IF NECESSARY**: If an overlap cannot be resolved (especially multiple overlapping items) or scaling fails, **DELETE** one of the conflicting elements.
        - **ADD MISSING ITEMS**: 
            - If "Missing Perimeter Wall" error exists, ADD new 'wall' elements along the layout boundaries (x=0, y=0, x=MAX, y=MAX).
            - If "Layout must have at least one Entrance/Exit" error exists, ADD 'entrance' or 'exit' (and ensure they touch a wall).
        - **Rules**:
            - 'staircase'/'elevator' must be OFF 'driving_lane' (on Ground).
            - 'parking_space' must NOT overlap 'parking_space'.
            - 'wall' must NOT overlap 'driving_lane' (they can touch edges).
            - 'pedestrian_path' must be ON the road.
        
        Return the FULL updated list of elements (including new walls, fixed items, and unchanged items, excluding deleted items).
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
          required: ["width", "height", "elements"],
        },
      },
    });

    return JSON.parse(response.text || "{}") as ParkingLayout;

  } catch (error) {
    console.error("Fix failed:", error);
    throw error;
  }
};

export const editLayout = async (currentLayout: ParkingLayout, instruction: string): Promise<ParkingLayout> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key required");

  // Use Gemini 2.5 Flash for editing as well to match user request for consistent model usage
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `
        Edit this parking layout based on the user instruction.
        
        User Instruction: "${instruction}"
        
        Current Layout:
        ${JSON.stringify(currentLayout)}
        
        Return the FULL updated layout JSON.
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
          required: ["width", "height", "elements"],
        },
      },
    });

    return JSON.parse(response.text || "{}") as ParkingLayout;
  } catch (error) {
    console.error("Edit failed:", error);
    throw error;
  }
};

export const generateRealisticImage = async (layout: ParkingLayout, resolution: '1K' | '2K' | '4K'): Promise<string | null> => {
   const apiKey = getApiKey();
   if (!apiKey) throw new Error("API Key required");

   try {
     const ai = new GoogleGenAI({ apiKey });
     
     // Create a simplified text representation of the layout for the image prompt
     const elementsDesc = layout.elements.map(e => `${e.type} at (${Math.round(e.x)},${Math.round(e.y)})`).join(', ');
     const prompt = `A realistic top-down view of an underground parking lot. 
     Layout features: ${elementsDesc}.
     High contrast, professional architectural visualization, concrete textures, realistic lighting.`;

     // Note: imageSize is NOT supported in gemini-2.5-flash-image, so we omit it here.
     const response = await ai.models.generateContent({
       model: "gemini-2.5-flash-image",
       contents: {
         parts: [{ text: prompt }]
       }
     });

     // Extract image
     for (const part of response.candidates?.[0]?.content?.parts || []) {
       if (part.inlineData) {
         return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
       }
     }
     return null;
   } catch (error) {
     console.error("Image gen failed:", error);
     throw error;
   }
};
