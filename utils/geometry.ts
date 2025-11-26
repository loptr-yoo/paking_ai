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
   // Simple AABB check for optimization before SAT
   const pad = 2; 
   return (
     item.x + item.width >= road.x - pad &&
     item.x <= road.x + road.width + pad &&
     item.y + item.height >= road.y - pad &&
     item.y <= road.y + road.height + pad
   ) && isPolygonsIntersecting(getCorners(road), getCorners(item));
}

// Check if two elements are touching or overlapping (for Wall-Entrance check)
function isTouching(a: LayoutElement, b: LayoutElement): boolean {
    const cornersA = getCorners(a);
    const cornersB = getCorners(b);
    return isPolygonsIntersecting(cornersA, cornersB);
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
    ElementType.BUILDING,
    ElementType.STAIRCASE,
    ElementType.ELEVATOR,
    ElementType.ROAD // Added Road to check against Walls
  ];
  
  const solids = layout.elements.filter(e => solidTypes.includes(e.type as ElementType));

  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const el1 = solids[i];
      const el2 = solids[j];

      // Ignore Wall-Wall overlap
      if (el1.type === ElementType.WALL && el2.type === ElementType.WALL) continue;
      
      // Ignore Road-Road overlap (Intersections are allowed)
      if (el1.type === ElementType.ROAD && el2.type === ElementType.ROAD) continue;

      // Ignore Road vs Non-Wall Solids (Roads contain things, but Roads vs Walls is bad)
      if ((el1.type === ElementType.ROAD && el2.type !== ElementType.WALL) || 
          (el2.type === ElementType.ROAD && el1.type !== ElementType.WALL)) {
          continue;
      }

      // Parking Space vs Parking Space - STRICT NO OVERLAP
      // (Loop naturally handles this as they are both in solidTypes)

      const r1 = Math.max(el1.width, el1.height);
      const r2 = Math.max(el2.width, el2.height);
      const dist = Math.sqrt(Math.pow(el1.x - el2.x, 2) + Math.pow(el1.y - el2.y, 2));
      
      // Optimization: Distance check
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
    ElementType.RAMP,
    ElementType.SPEED_BUMP,
    ElementType.LANE_LINE,
    ElementType.CONVEX_MIRROR
  ];

  // 4. Placement Constraints (Items that MUST NOT be on a ROAD)
  const itemsNotOnRoad = [
      ElementType.STAIRCASE,
      ElementType.ELEVATOR,
      ElementType.BUILDING
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
           message: `${item.type} must NOT be on a Driving Lane (Move to Ground).`
       });
    }
  });


  // 5. Wall Adjacency Constraints (Entrances/Exits MUST touch a wall)
  const wallDependents = [
      ElementType.ENTRANCE,
      ElementType.EXIT,
      ElementType.SAFE_EXIT
  ];
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

  // 6. Connectivity Check (Basic Graph)
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

        const queue = [startRoad.id];
        const visited = new Set<string>([startRoad.id]);
        let foundExit = false;

        while(queue.length > 0) {
            const currId = queue.shift()!;
            const currRoad = roads.find(r => r.id === currId);
            
            if (currRoad && exits.some(ex => isPolygonsIntersecting(getCorners(currRoad), getCorners(ex)))) {
                foundExit = true;
                break;
            }

            const neighbors = roadGraph.get(currId) || [];
            for(const n of neighbors) {
                if(!visited.has(n)) {
                    visited.add(n);
                    queue.push(n);
                }
            }
        }

        if (!foundExit) {
            violations.push({ elementId: ent.id, type: 'connectivity_error', message: 'No valid path to exit.' });
        }
    });
  }

  // 7. Check Mandatory Counts (At least 1 Entrance, 1 Exit)
  if (entrances.length === 0) {
    violations.push({ elementId: 'global', type: 'placement_error', message: 'Layout must have at least one Entrance.' });
  }
  if (exits.length === 0) {
    violations.push({ elementId: 'global', type: 'placement_error', message: 'Layout must have at least one Exit.' });
  }

  // 8. Check Outer Walls (Perimeter)
  // Check if we have walls near boundaries (within 20 units)
  const hasTopWall = walls.some(w => w.y < 20 && w.width > 50);
  const hasBottomWall = walls.some(w => w.y + w.height > layout.height - 20 && w.width > 50);
  const hasLeftWall = walls.some(w => w.x < 20 && w.height > 50);
  const hasRightWall = walls.some(w => w.x + w.width > layout.width - 20 && w.height > 50);

  if (!hasTopWall) violations.push({ elementId: 'global', type: 'placement_error', message: 'Missing Top Perimeter Wall.' });
  if (!hasBottomWall) violations.push({ elementId: 'global', type: 'placement_error', message: 'Missing Bottom Perimeter Wall.' });
  if (!hasLeftWall) violations.push({ elementId: 'global', type: 'placement_error', message: 'Missing Left Perimeter Wall.' });
  if (!hasRightWall) violations.push({ elementId: 'global', type: 'placement_error', message: 'Missing Right Perimeter Wall.' });

  return violations;
}
