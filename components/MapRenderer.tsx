import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { ParkingLayout, ElementType, ConstraintViolation } from '../types';

interface MapRendererProps {
  layout: ParkingLayout;
  violations: ConstraintViolation[];
}

const ELEMENT_STYLES: Record<string, { fill: string; stroke: string; opacity: number; labelColor?: string }> = {
  [ElementType.GROUND]: { fill: '#1e293b', stroke: 'none', opacity: 1 },
  [ElementType.ROAD]: { fill: '#334155', stroke: '#475569', opacity: 1 }, 
  [ElementType.PARKING_SPACE]: { fill: '#1e3a8a', stroke: '#60a5fa', opacity: 0.4 }, 
  [ElementType.SIDEWALK]: { fill: 'none', stroke: 'none', opacity: 0.9 }, 
  [ElementType.RAMP]: { fill: 'url(#rampGradient)', stroke: '#9333ea', opacity: 0.7 },
  [ElementType.PILLAR]: { fill: '#94a3b8', stroke: '#64748b', opacity: 1 }, 
  [ElementType.WALL]: { fill: '#94a3b8', stroke: '#64748b', opacity: 1 },
  [ElementType.ENTRANCE]: { fill: '#166534', stroke: '#22c55e', opacity: 0.8 },
  [ElementType.EXIT]: { fill: '#991b1b', stroke: '#ef4444', opacity: 0.8 },
  [ElementType.STAIRCASE]: { fill: '#6b21a8', stroke: '#a855f7', opacity: 0.8 },
  [ElementType.ELEVATOR]: { fill: '#0ea5e9', stroke: '#38bdf8', opacity: 0.8 },
  [ElementType.CHARGING_STATION]: { fill: '#10b981', stroke: '#34d399', opacity: 0.6 },
  [ElementType.GUIDANCE_SIGN]: { fill: '#facc15', stroke: '#ca8a04', opacity: 1, labelColor: 'black' },
  [ElementType.SAFE_EXIT]: { fill: '#22c55e', stroke: '#15803d', opacity: 1 },
  [ElementType.SPEED_BUMP]: { fill: 'url(#speedBumpPattern)', stroke: '#854d0e', opacity: 0.9 }, 
  [ElementType.FIRE_EXTINGUISHER]: { fill: '#dc2626', stroke: '#991b1b', opacity: 1 },
  [ElementType.LANE_LINE]: { fill: 'none', stroke: '#facc15', opacity: 0.8 },
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
    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    
    // Ramp Gradient
    const rampGrad = defs.append("linearGradient")
      .attr("id", "rampGradient")
      .attr("x1", "0%").attr("y1", "0%")
      .attr("x2", "100%").attr("y2", "0%");
    rampGrad.append("stop").attr("offset", "0%").attr("stop-color", "#7e22ce").attr("stop-opacity", 0.4);
    rampGrad.append("stop").attr("offset", "100%").attr("stop-color", "#d8b4fe").attr("stop-opacity", 0.9);

    // Speed Bump Stripes Pattern
    const pattern = defs.append("pattern")
      .attr("id", "speedBumpPattern")
      .attr("width", 10)
      .attr("height", 10)
      .attr("patternUnits", "userSpaceOnUse")
      .attr("patternTransform", "rotate(45)");
    pattern.append("rect").attr("width", 5).attr("height", 10).attr("fill", "#eab308"); // Yellow
    pattern.append("rect").attr("x", 5).attr("width", 5).attr("height", 10).attr("fill", "#000"); // Black

    const zoomGroup = svg.append("g");
    
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on("zoom", (event) => {
        zoomGroup.attr("transform", event.transform);
        setZoomState(event.transform);
      });

    svg.call(zoom);

    zoomGroup.append("rect")
      .attr("width", layout.width)
      .attr("height", layout.height)
      .attr("fill", "#0f172a")
      .attr("stroke", "#334155");

    const zIndexOrder = [
      ElementType.GROUND,
      ElementType.ROAD,
      ElementType.LANE_LINE,
      ElementType.SIDEWALK,
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

    groups.each(function(d) {
      const g = d3.select(this);
      const style = ELEMENT_STYLES[d.type] || { fill: '#64748b', stroke: 'none', opacity: 1 };
      const violationColor = getViolationColor(d.id);
      
      if (d.type === ElementType.LANE_LINE) {
        const isHorizontal = d.width >= d.height;
        g.append("line")
          .attr("x1", isHorizontal ? 0 : d.width / 2)
          .attr("y1", isHorizontal ? d.height / 2 : 0)
          .attr("x2", isHorizontal ? d.width : d.width / 2)
          .attr("y2", isHorizontal ? d.height / 2 : d.height)
          .attr("stroke", violationColor || style.stroke)
          .attr("stroke-width", 2)
          .attr("stroke-dasharray", "15, 15")
          .attr("opacity", style.opacity);
        return; 
      }

      if (d.type === ElementType.SIDEWALK) {
        g.append("rect")
            .attr("width", d.width)
            .attr("height", d.height)
            .attr("fill", "none")
            .attr("stroke", violationColor || "none")
            .attr("stroke-width", violationColor ? 2 : 0);

        const isHorizontal = d.width >= d.height; 
        const numLines = 3;
        
        // Logic: Horizontal Path (crossing vertical road) -> Vertical Stripes
        if (isHorizontal) {
             const barWidth = Math.min(d.width / 6, 8); 
             const barHeight = d.height * 0.8;
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
        } else {
             // Vertical Path (crossing horizontal road) -> Horizontal Stripes
             const barHeight = Math.min(d.height / 6, 8); 
             const barWidth = d.width * 0.8; 
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
        }
        return;
      }

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
            if (d.type === ElementType.SPEED_BUMP) return 2;
            return 1;
        });
    });

    groups.filter(d => d.type === ElementType.RAMP || d.type === ElementType.GUIDANCE_SIGN)
       .append("path")
       .attr("d", d => {
           const w = d.width; 
           const h = d.height;
           if (d.type === ElementType.GUIDANCE_SIGN) {
               // Sharp Arrow for guidance sign
               // M(tail_start) L(head_start) M(head_top) L(tip) L(head_bottom)
               const arrowTailX = w * 0.15;
               const arrowHeadBaseX = w * 0.7;
               const arrowTipX = w * 0.9;
               const centerY = h / 2;
               
               return `
                 M ${arrowTailX} ${centerY} L ${arrowHeadBaseX} ${centerY} 
                 M ${arrowHeadBaseX} ${h * 0.25} L ${arrowTipX} ${centerY} L ${arrowHeadBaseX} ${h * 0.75}
               `;
           }
           // Ramp Symbol
           return `M ${w*0.2} ${h/2} L ${w*0.8} ${h/2} L ${w*0.6} ${h*0.2} M ${w*0.8} ${h/2} L ${w*0.6} ${h*0.8}`;
       })
       .attr("stroke", d => d.type === ElementType.GUIDANCE_SIGN ? "black" : "white")
       .attr("stroke-width", 2)
       .attr("stroke-linecap", "round")
       .attr("stroke-linejoin", "round")
       .attr("fill", "none");

    groups.filter(d => d.type === ElementType.PARKING_SPACE)
      .append("rect")
      .attr("x", 4).attr("y", 4)
      .attr("width", d => Math.max(0, d.width - 8))
      .attr("height", d => Math.max(0, d.height - 8))
      .attr("stroke", "white").attr("stroke-width", 1)
      .attr("fill", "none").attr("opacity", 0.3);

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
                          {type === ElementType.SIDEWALK && <div className="flex gap-0.5 flex-col items-center justify-center"><div className="w-2 h-0.5 bg-white"></div><div className="w-2 h-0.5 bg-white"></div></div>}
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