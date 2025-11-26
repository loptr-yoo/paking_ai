import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { ParkingLayout, ElementType, ConstraintViolation } from '../types';

interface MapRendererProps {
  layout: ParkingLayout;
  violations: ConstraintViolation[];
}

// Semantic Color Palette
// PILLAR updated to match WALL colors
const ELEMENT_STYLES: Record<string, { fill: string; stroke: string; opacity: number; labelColor?: string }> = {
  [ElementType.GROUND]: { fill: '#1e293b', stroke: 'none', opacity: 1 },
  [ElementType.ROAD]: { fill: '#334155', stroke: '#475569', opacity: 1 }, // Dark Gray
  [ElementType.PARKING_SPACE]: { fill: '#1e3a8a', stroke: '#60a5fa', opacity: 0.4 }, // Dark Blue
  [ElementType.SIDEWALK]: { fill: 'none', stroke: 'none', opacity: 0.9 }, // Rendering handled manually
  [ElementType.RAMP]: { fill: 'url(#rampGradient)', stroke: '#9333ea', opacity: 0.7 },
  [ElementType.PILLAR]: { fill: '#94a3b8', stroke: '#64748b', opacity: 1 }, // Matches WALL
  [ElementType.WALL]: { fill: '#94a3b8', stroke: '#64748b', opacity: 1 },
  [ElementType.BUILDING]: { fill: '#020617', stroke: '#1e293b', opacity: 1 },
  [ElementType.ENTRANCE]: { fill: '#166534', stroke: '#22c55e', opacity: 0.8 },
  [ElementType.EXIT]: { fill: '#991b1b', stroke: '#ef4444', opacity: 0.8 },
  [ElementType.STAIRCASE]: { fill: '#6b21a8', stroke: '#a855f7', opacity: 0.8 },
  [ElementType.ELEVATOR]: { fill: '#0ea5e9', stroke: '#38bdf8', opacity: 0.8 },
  [ElementType.CHARGING_STATION]: { fill: '#10b981', stroke: '#34d399', opacity: 0.6 },
  [ElementType.GUIDANCE_SIGN]: { fill: '#facc15', stroke: '#ca8a04', opacity: 1, labelColor: 'black' },
  [ElementType.SAFE_EXIT]: { fill: '#22c55e', stroke: '#15803d', opacity: 1 },
  [ElementType.SPEED_BUMP]: { fill: '#eab308', stroke: '#854d0e', opacity: 0.8 },
  [ElementType.FIRE_EXTINGUISHER]: { fill: '#dc2626', stroke: '#991b1b', opacity: 1 },
  [ElementType.LANE_LINE]: { fill: 'none', stroke: '#facc15', opacity: 0.8 }, // Yellow dashed lines
  [ElementType.CONVEX_MIRROR]: { fill: '#f97316', stroke: '#ea580c', opacity: 1 },
};

const MapRenderer: React.FC<MapRendererProps> = ({ layout, violations }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoomState, setZoomState] = useState<d3.ZoomTransform>(d3.zoomIdentity);

  const getViolationColor = (elementId: string) => {
    const isError = violations.some(v => v.elementId === elementId);
    return isError ? '#ef4444' : null;
  };

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !layout) return;

    const svg = d3.select(svgRef.current);
    
    // Clear previous renders
    svg.selectAll("*").remove();

    // Define Gradients & Patterns
    const defs = svg.append("defs");
    
    const rampGrad = defs.append("linearGradient")
      .attr("id", "rampGradient")
      .attr("x1", "0%")
      .attr("y1", "0%")
      .attr("x2", "100%")
      .attr("y2", "0%");
    rampGrad.append("stop").attr("offset", "0%").attr("stop-color", "#7e22ce").attr("stop-opacity", 0.4);
    rampGrad.append("stop").attr("offset", "100%").attr("stop-color", "#d8b4fe").attr("stop-opacity", 0.9);

    const zoomGroup = svg.append("g");
    
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on("zoom", (event) => {
        zoomGroup.attr("transform", event.transform);
        setZoomState(event.transform);
      });

    svg.call(zoom);

    // 1. Draw Canvas Background
    zoomGroup.append("rect")
      .attr("width", layout.width)
      .attr("height", layout.height)
      .attr("fill", "#0f172a")
      .attr("stroke", "#334155");

    // 2. Sort elements by Z-Index
    const zIndexOrder = [
      ElementType.GROUND,
      ElementType.BUILDING,
      ElementType.ROAD,
      ElementType.LANE_LINE,     // Markings on road
      ElementType.SIDEWALK,      // Paths on road
      ElementType.PARKING_SPACE,
      ElementType.SPEED_BUMP,
      ElementType.RAMP,
      ElementType.WALL,
      ElementType.PILLAR,
      ElementType.ENTRANCE,
      ElementType.EXIT,
      ElementType.STAIRCASE,
      ElementType.ELEVATOR,
      ElementType.CHARGING_STATION,
      ElementType.SAFE_EXIT,
      ElementType.FIRE_EXTINGUISHER,
      ElementType.GUIDANCE_SIGN,
      ElementType.CONVEX_MIRROR,
    ];

    const sortedElements = [...layout.elements].sort((a, b) => {
      const idxA = zIndexOrder.indexOf(a.type as ElementType);
      const idxB = zIndexOrder.indexOf(b.type as ElementType);
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });

    const groups = zoomGroup.selectAll("g.element")
      .data(sortedElements)
      .enter()
      .append("g")
      .attr("class", "element")
      .attr("transform", d => `translate(${d.x + d.width/2}, ${d.y + d.height/2}) rotate(${d.rotation || 0}) translate(${-d.width/2}, ${-d.height/2})`);

    // Main Shape Rendering
    groups.each(function(d) {
      const g = d3.select(this);
      const style = ELEMENT_STYLES[d.type] || { fill: '#64748b', stroke: 'none', opacity: 1 };
      const violationColor = getViolationColor(d.id);
      
      // Special rendering for Lane Lines (Dashed Line)
      if (d.type === ElementType.LANE_LINE) {
        const isHorizontal = d.width >= d.height;
        g.append("line")
          .attr("x1", isHorizontal ? 0 : d.width / 2)
          .attr("y1", isHorizontal ? d.height / 2 : 0)
          .attr("x2", isHorizontal ? d.width : d.width / 2)
          .attr("y2", isHorizontal ? d.height / 2 : d.height)
          .attr("stroke", violationColor || style.stroke)
          .attr("stroke-width", 2)
          .attr("stroke-dasharray", "15, 15") // Dashed style
          .attr("opacity", style.opacity);
        return; 
      }

      // Special rendering for Pedestrian Path
      if (d.type === ElementType.SIDEWALK) {
        // Transparent interaction bbox
        g.append("rect")
            .attr("width", d.width)
            .attr("height", d.height)
            .attr("fill", "none")
            .attr("stroke", violationColor || "none")
            .attr("stroke-width", violationColor ? 2 : 0);

        const isHorizontal = d.width >= d.height; 
        const numLines = 3;
        
        // RULE: "Stripes parallel to nearest ground line".
        // Assumption: If the Path is Horizontal (wide), it's likely on a Horizontal Road, so Ground Line is Horizontal.
        // Therefore, Stripes should be Horizontal.
        
        if (isHorizontal) {
             // Path BBox is Horizontal (Wide). 
             // We draw 3 Horizontal lines stacked vertically.
             const barHeight = Math.min(d.height / 6, 8); // Thin lines
             const barWidth = d.width * 0.3; 
             const spacing = (d.height - (numLines * barHeight)) / (numLines + 1);

             for (let i = 0; i < numLines; i++) {
                g.append("rect")
                    .attr("x", (d.width - barWidth) / 2)
                    .attr("y", spacing + i * (barHeight + spacing))
                    .attr("width", barWidth)
                    .attr("height", barHeight)
                    .attr("fill", "white")
                    .attr("opacity", 0.9);
             }
        } else {
             // Path BBox is Vertical (Tall).
             // We draw 3 Vertical lines stacked horizontally.
             const barWidth = Math.min(d.width / 6, 8); 
             const barHeight = d.height * 0.3;
             const spacing = (d.width - (numLines * barWidth)) / (numLines + 1);

             for (let i = 0; i < numLines; i++) {
                g.append("rect")
                    .attr("x", spacing + i * (barWidth + spacing))
                    .attr("y", (d.height - barHeight) / 2)
                    .attr("width", barWidth)
                    .attr("height", barHeight)
                    .attr("fill", "white")
                    .attr("opacity", 0.9);
             }
        }
        return;
      }

      // Default Rect Rendering
      g.append("rect")
        .attr("width", d.width)
        .attr("height", d.height)
        .attr("fill", () => {
          if (violationColor && d.type !== ElementType.ROAD) return 'rgba(239, 68, 68, 0.5)';
          return style.fill;
        })
        .attr("stroke", violationColor || style.stroke)
        .attr("stroke-width", violationColor ? 3 : (d.type === ElementType.WALL || d.type === ElementType.PILLAR ? 0 : 1))
        .attr("opacity", style.opacity)
        .attr("rx", () => {
            if (d.type === ElementType.PILLAR || d.type === ElementType.CONVEX_MIRROR) return 4;
            if (d.type === ElementType.SPEED_BUMP) return 5;
            return 1;
        });
    });


    // Semantic Details
    groups.filter(d => d.type === ElementType.RAMP || d.type === ElementType.GUIDANCE_SIGN)
       .append("path")
       .attr("d", d => {
           const w = d.width; 
           const h = d.height;
           return `M ${w*0.2} ${h/2} L ${w*0.8} ${h/2} L ${w*0.6} ${h*0.2} M ${w*0.8} ${h/2} L ${w*0.6} ${h*0.8}`;
       })
       .attr("stroke", d => d.type === ElementType.GUIDANCE_SIGN ? "black" : "white")
       .attr("stroke-width", 2)
       .attr("fill", "none");

    // Parking Lines
    groups.filter(d => d.type === ElementType.PARKING_SPACE)
      .append("rect")
      .attr("x", 4).attr("y", 4)
      .attr("width", d => Math.max(0, d.width - 8))
      .attr("height", d => Math.max(0, d.height - 8))
      .attr("stroke", "white").attr("stroke-width", 1)
      .attr("fill", "none").attr("opacity", 0.3);

    // Labels
    groups.filter(d => !!d.label || d.type === ElementType.BUILDING || d.type === ElementType.ENTRANCE || d.type === ElementType.EXIT)
      .append("text")
      .attr("x", d => d.width / 2)
      .attr("y", d => d.height / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", "middle")
      .attr("fill", d => ELEMENT_STYLES[d.type]?.labelColor || "white")
      .attr("font-size", d => Math.min(14, Math.max(10, d.width / 4)) + "px")
      .attr("font-weight", "bold")
      .style("pointer-events", "none")
      .text(d => d.label || d.id.substring(0, 4));

  }, [layout, violations]);

  return (
    <div ref={containerRef} className="w-full h-full bg-slate-950 overflow-hidden relative border border-slate-700 rounded-lg shadow-2xl">
      <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing"></svg>
      
      <div className="absolute top-4 left-4 bg-slate-900/95 p-3 rounded-lg border border-slate-700 shadow-xl max-h-[80vh] overflow-y-auto w-48 custom-scrollbar">
         <h4 className="text-xs font-bold text-slate-300 mb-3 uppercase tracking-wider border-b border-slate-800 pb-2">Legend</h4>
         <div className="space-y-2">
            {Object.entries(ELEMENT_STYLES).map(([type, style]) => (
                <div key={type} className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded shadow-sm flex-shrink-0 flex items-center justify-center overflow-hidden" 
                         style={{ backgroundColor: type === ElementType.LANE_LINE || type === ElementType.SIDEWALK ? 'transparent' : style.fill, border: `1px solid ${style.stroke}` }}>
                          {type === ElementType.LANE_LINE && <div className="w-full h-0.5 bg-yellow-400 border-dashed border-yellow-400"></div>}
                          {type === ElementType.SIDEWALK && <div className="flex gap-0.5 flex-col"><div className="w-2 h-0.5 bg-white"></div><div className="w-2 h-0.5 bg-white"></div></div>}
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium capitalize leading-tight">{type.replace(/_/g, ' ')}</span>
                </div>
            ))}
         </div>
      </div>
    </div>
  );
};

export default MapRenderer;
