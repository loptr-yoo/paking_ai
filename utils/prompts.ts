import { ParkingLayout, ConstraintViolation } from '../types';

export const PROMPTS = {
  generation: (description: string) => `
    You are an expert architect and spatial planner specializing in underground parking garage design. 
    Generate a COARSE-GRAINED JSON underground parking layout (0,0 at top-left) for: "${description}".
    
    SCOPE: Generate ONLY the structural foundation.
    REQUIRED TYPES: 'wall', 'pillar', 'driving_lane' (road), 'ground' (for parking areas), 'ramp', 'entrance', 'exit'.

    CRITICAL RULES:
    1. **Mandatory Elements**: You MUST generate at least one 'entrance', one 'exit', and one 'ramp'.
    2. **Entrance/Exit**: MUST be flat rectangular blocks (approx 40x20). MUST be on the PERIMETER WALL.
    3. **Ramps**: 
        - **NO OVERLAP**: Ramps MUST NOT overlap 'driving_lane' or 'ground'. They are distinct connectors.
        - **CONNECTIVITY**: Every 'entrance' and 'exit' must have a 'ramp' immediately attached to it (touching edges).
        - **ADJACENCY**: Ramps must connect to 'driving_lane' at the other end.
    4. **Ground Areas**: 
        - Generate one or more large 'ground' areas for parking.
        - **MANDATORY**: Generate SIDE strips of 'ground' along the perimeter walls to allow for side parking.
        - **IMPORTANT**: Grounds must run PARALLEL and be EQUAL LENGTH to adjacent roads.
    5. **Road Connectivity**: 
        - **ALL driving lanes must be connected** to form a single drivable network. 
    6. **Style**: 
        - Create a realistic and varied layout. Do not feel constrained to symmetrical designs.

    Output JSON using SHORT keys (t,x,y,w,h,r).
  `,

  refinement: (simplifiedLayout: any, width: number, height: number) => `
    You are a detail-oriented civil engineer.
    Analyze the provided COARSE-GRAINED layout and add **FINE-GRAINED** semantic details.
    
    Current Structure: ${JSON.stringify(simplifiedLayout)}
    Canvas: ${width}x${height}

    REQUIRED ADDITIONS:
    1. **Facilities**: Fill the empty centers of 'ground' islands with: 'elevator', 'staircase', 'fire_extinguisher', 'safe_exit'.
       - **CRITICAL**: Do NOT remove existing 'ground', 'road', or 'wall' elements. You must RETURN them in the list.
       - Place facilities ON TOP of existing grounds.
       - **RAMP SURROUNDINGS**: Specifically place 'elevator' and 'staircase' on the 'ground' pieces immediately adjacent to 'ramp' areas.
    2. **Road Details**: 
       - Add **'ground_line'** (lane dividers) running down the CENTER of every 'driving_lane'. 
       - **CRITICAL**: Do NOT generate 'ground_line' inside intersections.
       - Add **'pedestrian_path'** (zebra crossings) connecting parking areas to elevators/exits.
    3. **Signage**: 
       - Add **'guidance_sign'** at EVERY road intersection. 
       - **IMPORTANT**: Set rotation 'r' so the arrow points correctly.
    4. **Safety**:
       - Add 'speed_bump' near ramps or intersections.
  
    Output JSON using SHORT keys: t, x, y, w, h, r, l.
  `,

  fix: (layout: ParkingLayout, violations: ConstraintViolation[]) => `
    You are a precise spatial error-correction system.
    
    Current Elements (Simplified): ${JSON.stringify(layout.elements.map(e => ({id: e.id, t: e.type, x: e.x, y: e.y, w: e.width, h: e.height, r: e.rotation})))}
    
    Violations (Top Priority): ${JSON.stringify(violations)}
    
    INSTRUCTIONS:
    1. **Entrances/Exits/Ramps**: 
       - Fix perimeter placement.
       - **CRITICAL**: Every 'entrance'/'exit' MUST have a 'ramp' directly attached.
       - 'ramp' CAN NOT overlap 'driving_lane', 'ground' or 'parking_space'. Resize/Move to be strictly ADJACENT.
    2. **Connectivity**:
       - Fix 'No drivable path' errors by adding/moving 'driving_lane' segments.
    3. **Parking**: Delete parking spaces overlapping solids > 50%.
    4. **Safe Exits**: Move 'safe_exit' off roads.
    5. **Chain of Thought**: First, add a field "_thinking" to explain your fix plan. Then return the full JSON.

    Return the **FULL, UPDATED** JSON layout object.
  `
};