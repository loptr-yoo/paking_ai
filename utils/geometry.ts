import { LayoutElement, ParkingLayout, ConstraintViolation, ElementType } from '../types';

// Helper to get corners of a rotated rectangle
function getCorners(el: LayoutElement) {
  const rad = ((el.rotation || 0) * Math.PI) / 180;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;

  const corners = [
    { x: el.x, y: el.y },
    { x: el.x + el.width, y: el.y },
    { x: el.x + el.width, y: el.y + el.height },
    { x: el.x, y: el.y + el.height },
  ];

  // Rotate point around center
  return corners.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return {
      x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
      y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
    };
  });
}

// Separating Axis Theorem (SAT) for collision detection
function isPolygonsIntersecting(a: {x: number, y: number}[], b: {x: number, y: number}[]) {
  if (a.length < 3 || b.length < 3) return false;

  const polygons = [a, b];
  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    for (let j = 0; j < polygon.length; j++) {
      const k = (j + 1) % polygon.length;
      const normal = {
        x: polygon[k].y - polygon[j].y,
        y: polygon[j].x - polygon[k].x,
      };

      // Check for zero-length edges to prevent NaN issues
      if (normal.x === 0 && normal.y === 0) continue;

      let minA = Infinity, maxA = -Infinity;
      for (const p of a) {
        const projected = normal.x * p.x + normal.y * p.y;
        if (projected < minA) minA = projected;
        if (projected > maxA) maxA = projected;
      }

      let minB = Infinity, maxB = -Infinity;
      for (const p of b) {
        const projected = normal.x * p.x + normal.y * p.y;
        if (projected < minB) minB = projected;
        if (projected > maxB) maxB = projected;
      }

      if (maxA < minB || maxB < minA) {
        return false;
      }
    }
  }
  return true;
}

// Check if smaller element B is contained within or substantially overlapping larger element A
function isOverlapping(road: LayoutElement, item: LayoutElement): boolean {
   const pad = 2; 
   return (
     item.x + item.width >= road.x - pad &&
     item.x <= road.x + road.width + pad &&
     item.y + item.height >= road.y - pad &&
     item.y <= road.y + road.height + pad
   ) && isPolygonsIntersecting(getCorners(road), getCorners(item));
}

// Check if two elements are touching or overlapping
function isTouching(a: LayoutElement, b: LayoutElement): boolean {
    const cornersA = getCorners(a);
    const cornersB = getCorners(b);
    return isPolygonsIntersecting(cornersA, cornersB);
}

// Helper to get intersection rectangle of two AABBs (Axis Aligned Bounding Boxes)
// Only works reliably for non-rotated roads, which is standard for this grid layout
function getIntersectionBox(r1: LayoutElement, r2: LayoutElement) {
    const x1 = Math.max(r1.x, r2.x);
    const y1 = Math.max(r1.y, r2.y);
    const x2 = Math.min(r1.x + r1.width, r2.x + r2.width);
    const y2 = Math.min(r1.y + r1.height, r2.y + r2.height);

    if (x1 < x2 && y1 < y2) {
        return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    }
    return null;
}

// Helper to determine the "side" of the layout an element is on
function getLayoutSide(el: LayoutElement, layoutW: number, layoutH: number): 'top' | 'bottom' | 'left' | 'right' {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    
    // Distance to edges
    const distTop = cy;
    const distBottom = layoutH - cy;
    const distLeft = cx;
    const distRight = layoutW - cx;
    
    const min = Math.min(distTop, distBottom, distLeft, distRight);
    
    if (min === distTop) return 'top';
    if (min === distBottom) return 'bottom';
    if (min === distLeft) return 'left';
    return 'right';
}

export function validateLayout(layout: ParkingLayout): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  if (!layout || !layout.elements) return violations;

  // 1. Check Out of Bounds
  layout.elements.forEach(el => {
    const corners = getCorners(el);
    const isOutside = corners.some(p => p.x < 0 || p.x > layout.width || p.y < 0 || p.y > layout.height);
    if (isOutside) {
      violations.push({
        elementId: el.id,
        type: 'out_of_bounds',
        message: `Element is outside the parking boundary.`
      });
    }
  });

  // 2. Check Overlaps
  const solidTypes = [
    ElementType.PARKING_SPACE, 
    ElementType.PILLAR, 
    ElementType.WALL, 
    ElementType.STAIRCASE,
    ElementType.ELEVATOR,
    ElementType.ROAD
  ];
  
  const solids = layout.elements.filter(e => solidTypes.includes(e.type as ElementType));

  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const el1 = solids[i];
      const el2 = solids[j];

      // Ignore Wall-Wall overlaps (corners)
      if (el1.type === ElementType.WALL && el2.type === ElementType.WALL) continue;
      // Ignore Road-Road overlaps (intersections)
      if (el1.type === ElementType.ROAD && el2.type === ElementType.ROAD) continue;
      
      // NEW: Ignore Pillar-Wall overlaps (Pillars can be inside/embedded in walls)
      if ((el1.type === ElementType.PILLAR && el2.type === ElementType.WALL) ||
          (el2.type === ElementType.PILLAR && el1.type === ElementType.WALL)) {
          continue;
      }
      
      const r1 = Math.max(el1.width, el1.height);
      const r2 = Math.max(el2.width, el2.height);
      const dist = Math.sqrt(Math.pow(el1.x - el2.x, 2) + Math.pow(el1.y - el2.y, 2));
      
      // Optimization: Simple distance check before expensive SAT
      if (dist < r1 + r2) {
         if (isPolygonsIntersecting(getCorners(el1), getCorners(el2))) {
             violations.push({
               elementId: el1.id,
               targetId: el2.id,
               type: 'overlap',
               message: `${el1.type} overlaps with ${el2.type}`
             });
         }
      }
    }
  }

  // 3. Placement Constraints (Items that MUST be on a ROAD)
  const itemsOnRoad = [
    ElementType.GUIDANCE_SIGN,
    ElementType.SIDEWALK,
    ElementType.SPEED_BUMP,
    ElementType.LANE_LINE,
    ElementType.CONVEX_MIRROR
  ];

  // 4. Placement Constraints (Items that MUST NOT be on a ROAD)
  // NOTE: PILLAR is handled in solid collision (overlap) check above.
  const itemsNotOnRoad = [
      ElementType.STAIRCASE,
      ElementType.ELEVATOR,
  ];

  const roads = layout.elements.filter(e => e.type === ElementType.ROAD);
  
  // Must be ON Road
  const dependentItems = layout.elements.filter(e => itemsOnRoad.includes(e.type as ElementType));
  dependentItems.forEach(item => {
    const isOnRoad = roads.some(road => isOverlapping(road, item));
    if (!isOnRoad) {
       violations.push({
         elementId: item.id,
         type: 'placement_error',
         message: `${item.type} must be placed on a Driving Lane.`
       });
    }
  });

  // Must be OFF Road
  const restrictedItems = layout.elements.filter(e => itemsNotOnRoad.includes(e.type as ElementType));
  restrictedItems.forEach(item => {
    const isOnRoad = roads.some(road => isOverlapping(road, item));
    if (isOnRoad) {
       violations.push({
           elementId: item.id,
           type: 'placement_error',
           message: `${item.type} must NOT be on a Driving Lane.`
       });
    }
  });

  // 4b. Intersection Constraints
  const noIntersectionItems = [ElementType.LANE_LINE, ElementType.SPEED_BUMP, ElementType.SIDEWALK];
  const intersectionRestricted = layout.elements.filter(e => noIntersectionItems.includes(e.type as ElementType));
  
  if (intersectionRestricted.length > 0) {
      for (let i = 0; i < roads.length; i++) {
          for (let j = i + 1; j < roads.length; j++) {
              const r1 = roads[i];
              const r2 = roads[j];
              
              // Find intersection box
              const box = getIntersectionBox(r1, r2);
              if (box && box.width > 5 && box.height > 5) {
                   // Check if restricted items overlap this box
                   intersectionRestricted.forEach(item => {
                       const itemBox = {x: item.x, y: item.y, width: item.width, height: item.height}; // Assume unrotated for box check
                       const overlap = getIntersectionBox(box as any, itemBox as any);
                       if (overlap && overlap.width > 1 && overlap.height > 1) {
                           violations.push({
                               elementId: item.id,
                               type: 'placement_error',
                               message: `${item.type} cannot be placed in a road intersection.`
                           });
                       }
                   });
              }
          }
      }
  }


  // 5. Wall Adjacency Constraints
  const wallDependents = [ElementType.ENTRANCE, ElementType.EXIT]; 
  const walls = layout.elements.filter(e => e.type === ElementType.WALL);
  const itemsNeedingWall = layout.elements.filter(e => wallDependents.includes(e.type as ElementType));

  itemsNeedingWall.forEach(item => {
      const touchesWall = walls.some(wall => isTouching(wall, item));
      if (!touchesWall) {
          violations.push({
              elementId: item.id,
              type: 'placement_error',
              message: `${item.type} must be adjacent to or touching a Wall.`
          });
      }
  });
  
  // 5b. Safe Exit -> Staircase Constraints (Moved OUT of wall dependents)
  const safeExits = layout.elements.filter(e => e.type === ElementType.SAFE_EXIT);
  const staircases = layout.elements.filter(e => e.type === ElementType.STAIRCASE);
  safeExits.forEach(item => {
      const touchesStair = staircases.some(stair => isTouching(stair, item));
      if (!touchesStair) {
          violations.push({
              elementId: item.id,
              type: 'placement_error',
              message: `Safe Exit must be adjacent to a Staircase.`
          });
      }
  });

  // 6. Connectivity Check
  const entrances = layout.elements.filter(e => e.type === ElementType.ENTRANCE);
  const exits = layout.elements.filter(e => e.type === ElementType.EXIT);
  
  if (entrances.length > 0 && exits.length > 0 && roads.length > 0) {
    const roadGraph = new Map<string, string[]>();
    roads.forEach(r => roadGraph.set(r.id, []));

    for(let i=0; i<roads.length; i++) {
        for(let j=i+1; j<roads.length; j++) {
            if(isPolygonsIntersecting(getCorners(roads[i]), getCorners(roads[j]))) {
                roadGraph.get(roads[i].id)?.push(roads[j].id);
                roadGraph.get(roads[j].id)?.push(roads[i].id);
            }
        }
    }

    entrances.forEach(ent => {
        const startRoad = roads.find(r => isPolygonsIntersecting(getCorners(r), getCorners(ent)));
        if (!startRoad) {
             violations.push({ elementId: ent.id, type: 'connectivity_error', message: 'Entrance not connected to road.' });
             return;
        }
    });
  }
  
  // 6b. Entrance/Exit Count Check
  if (entrances.length < 1) {
       violations.push({ elementId: 'global', type: 'connectivity_error', message: 'Layout must have at least one Entrance.' });
  }
  if (exits.length < 1) {
       violations.push({ elementId: 'global', type: 'connectivity_error', message: 'Layout must have at least one Exit.' });
  }

  // 6c. Entrance/Exit Side Separation Check
  const sidesWithEntrance = new Set(entrances.map(e => getLayoutSide(e, layout.width, layout.height)));
  const sidesWithExit = new Set(exits.map(e => getLayoutSide(e, layout.width, layout.height)));

  for (const side of sidesWithEntrance) {
      if (sidesWithExit.has(side)) {
          violations.push({
              elementId: 'global',
              type: 'connectivity_error',
              message: `Entrances and Exits cannot be on the same wall side (${side}).`
          });
      }
  }

  // 7. Parking Orientation Check
  const parkingSpaces = layout.elements.filter(e => e.type === ElementType.PARKING_SPACE);
  parkingSpaces.forEach(space => {
      const adjacentRoad = roads.find(r => isTouching(r, space) || isOverlapping({ ...r, width: r.width + 10, height: r.height + 10, x: r.x - 5, y: r.y - 5 } as any, space));
      if (adjacentRoad) {
          const roadIsHorizontal = adjacentRoad.width > adjacentRoad.height;
          const spaceIsHorizontal = space.width > space.height;
          
          if (roadIsHorizontal === spaceIsHorizontal) {
              violations.push({
                  elementId: space.id,
                  type: 'placement_error',
                  message: 'Parking space must be Perpendicular to the road (Back-in).'
              });
          }
      }
  });
  
  // 8. Speed Bump Size Check
  const bumps = layout.elements.filter(e => e.type === ElementType.SPEED_BUMP);
  bumps.forEach(bump => {
      const size = Math.min(bump.width, bump.height);
      const len = Math.max(bump.width, bump.height);
      if (size > 20) { 
           violations.push({ elementId: bump.id, type: 'invalid_dimension', message: 'Speed bump too thick.' });
      }
  });

  // 9. Road Width Check
  roads.forEach(road => {
      const minorDim = Math.min(road.width, road.height);
      if (minorDim > 120) { // Threshold for "too wide"
           violations.push({ 
               elementId: road.id, 
               type: 'invalid_dimension', 
               message: 'Driving lane is excessively wide (possible plaza).' 
           });
      }
  });

  return violations;
}