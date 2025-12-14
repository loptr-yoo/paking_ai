import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { ElementType } from '../types';
import { useStore } from '../store';

const ELEMENT_STYLES: Record<string, { fill: string; opacity: number }> = {
  [ElementType.GROUND]: { fill: '#475569', opacity: 1 },
  [ElementType.ROAD]: { fill: '#1e293b', opacity: 1 },
  [ElementType.PARKING_SPACE]: { fill: '#3b82f6', opacity: 1 },
  [ElementType.SIDEWALK]: { fill: 'url(#sidewalk-pattern)', opacity: 1 }, // Use Pattern
  [ElementType.RAMP]: { fill: '#c026d3', opacity: 1 },
  [ElementType.PILLAR]: { fill: '#94a3b8', opacity: 1 },
  [ElementType.WALL]: { fill: '#f1f5f9', opacity: 1 },
  [ElementType.ENTRANCE]: { fill: '#15803d', opacity: 1 },
  [ElementType.EXIT]: { fill: '#b91c1c', opacity: 1 },
  [ElementType.STAIRCASE]: { fill: '#7e22ce', opacity: 1 },
  [ElementType.ELEVATOR]: { fill: '#0284c7', opacity: 1 },
  [ElementType.CHARGING_STATION]: { fill: '#65a30d', opacity: 1 },
  [ElementType.GUIDANCE_SIGN]: { fill: '#d97706', opacity: 1 },
  [ElementType.SAFE_EXIT]: { fill: '#0d9488', opacity: 1 },
  [ElementType.SPEED_BUMP]: { fill: '#fbbf24', opacity: 1 },
  [ElementType.FIRE_EXTINGUISHER]: { fill: '#ef4444', opacity: 1 },
  [ElementType.LANE_LINE]: { fill: 'none', opacity: 1 },
  [ElementType.CONVEX_MIRROR]: { fill: '#f97316', opacity: 1 },
};

const MapRenderer: React.FC = () => {
  const { layout, violations } = useStore();
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !layout) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove(); // Clear previous

    // 1. Define Patterns
    const defs = svg.append("defs");
    const pattern = defs.append("pattern")
        .attr("id", "sidewalk-pattern")
        .attr("width", 8)
        .attr("height", 8)
        .attr("patternUnits", "userSpaceOnUse")
        .attr("patternTransform", "rotate(45)");
    
    pattern.append("rect").attr("width",8).attr("height",8).attr("fill","#cbd5e1");
    pattern.append("rect").attr("width",4).attr("height",8).attr("fill","#94a3b8"); // Stripe

    // 2. Zoom Group
    const zoomGroup = svg.append("g");
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on("zoom", (e) => zoomGroup.attr("transform", e.transform));
    svg.call(zoom);

    // 3. Background
    zoomGroup.append("rect")
      .attr("width", layout.width || 800)
      .attr("height", layout.height || 600)
      .attr("fill", "#0f172a");

    // 4. Sort Elements
    const zOrder = [ElementType.GROUND, ElementType.ROAD, ElementType.LANE_LINE, ElementType.SIDEWALK, ElementType.PARKING_SPACE, ElementType.RAMP, ElementType.WALL, ElementType.PILLAR, ElementType.ENTRANCE, ElementType.EXIT];
    const sorted = [...layout.elements].sort((a, b) => {
        const ia = zOrder.indexOf(a.type as ElementType), ib = zOrder.indexOf(b.type as ElementType);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    // 5. Render
    const groups = zoomGroup.selectAll("g.el")
      .data(sorted)
      .enter()
      .append("g")
      .attr("transform", d => `translate(${d.x + d.width/2}, ${d.y + d.height/2}) rotate(${d.rotation || 0}) translate(${-d.width/2}, ${-d.height/2})`);

    groups.each(function(d) {
        const g = d3.select(this);
        const style = ELEMENT_STYLES[d.type] || { fill: '#ccc', opacity: 1 };
        const isError = violations.some(v => v.elementId === d.id);
        const color = isError ? '#ef4444' : style.fill;

        if (d.type === ElementType.LANE_LINE) {
            g.append("line")
             .attr("x1",0).attr("y1",d.height/2).attr("x2",d.width).attr("y2",d.height/2)
             .attr("stroke", "#facc15").attr("stroke-width", 2).attr("stroke-dasharray", "8,8");
            return;
        }

        g.append("rect")
         .attr("width", d.width)
         .attr("height", d.height)
         .attr("fill", color)
         .attr("stroke", isError ? "red" : "none")
         .attr("stroke-width", isError ? 2 : 0)
         .attr("rx", (d.type === ElementType.PILLAR) ? 4 : 0);
        
        // Guidance Arrow
        if (d.type === ElementType.GUIDANCE_SIGN) {
            const cx = d.width/2, cy = d.height/2, s = Math.min(d.width, d.height)*0.8;
            g.append("path")
             .attr("d", `M ${cx-s/2} ${cy} L ${cx} ${cy-s/2} L ${cx+s/2} ${cy}`)
             .attr("stroke", "white").attr("fill", "none");
        }
    });

    // Auto-Fit Logic
    if (layout.width > 0 && svgRef.current?.parentElement) {
        const { clientWidth: pw, clientHeight: ph } = svgRef.current.parentElement;
        const scale = Math.min(pw / layout.width, ph / layout.height) * 0.95;
        const tx = (pw - layout.width * scale) / 2;
        const ty = (ph - layout.height * scale) / 2;
        svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    }
  }, [layout, violations]);

  return (
    <div className="w-full h-full bg-slate-950 overflow-hidden relative border border-slate-700 rounded-lg">
      <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing"></svg>
    </div>
  );
};

export default MapRenderer;