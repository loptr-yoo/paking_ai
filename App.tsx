import React, { useState, useEffect } from 'react';
import MapRenderer from './components/MapRenderer';
import LayoutControl from './components/LayoutControl';
import { ParkingLayout, ConstraintViolation } from './types';
import { validateLayout } from './utils/geometry';
import { generateParkingLayout, augmentLayoutWithRoads, fixLayoutViolations } from './services/geminiService';
import { parseCustomLayout } from './utils/parsers';

const App: React.FC = () => {
  const [layout, setLayout] = useState<ParkingLayout | null>(null);
  const [violations, setViolations] = useState<ConstraintViolation[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial Demo Data load
  useEffect(() => {
    // Trigger a default generation for demo purposes on load
    handleGenerate("Default demo layout");
  }, []);

  const handleUpload = (jsonString: string) => {
    try {
      const parsed = JSON.parse(jsonString);
      let newLayout: ParkingLayout;

      // Check if it's the specific custom schema (canvas_size) or generic schema
      if (parsed.canvas_size) {
         newLayout = parseCustomLayout(parsed);
      } else {
         // Fallback to internal schema check
         if (!parsed.width || !parsed.height || !Array.isArray(parsed.elements)) {
            throw new Error("Invalid JSON structure.");
         }
         newLayout = parsed;
      }
      
      setError(null);
      setLayout(newLayout);
      const problems = validateLayout(newLayout);
      setViolations(problems);
    } catch (e: any) {
      setError(`Failed to parse JSON: ${e.message}`);
    }
  };

  const handleGenerate = async (prompt: string) => {
    setIsGenerating(true);
    setError(null);
    try {
      const newLayout = await generateParkingLayout(prompt);
      setLayout(newLayout);
      const problems = validateLayout(newLayout);
      setViolations(problems);
    } catch (e) {
      setError("Failed to generate layout.");
      console.error(e);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAugment = async () => {
    if (!layout) return;
    setIsGenerating(true);
    try {
      const newElements = await augmentLayoutWithRoads(layout);
      if (newElements.length > 0) {
        const updatedLayout = {
          ...layout,
          elements: [...layout.elements, ...newElements]
        };
        setLayout(updatedLayout);
        const problems = validateLayout(updatedLayout);
        setViolations(problems);
      } else {
        setError("AI could not identify valid road placements.");
      }
    } catch (e: any) {
      setError("Failed to augment layout: " + e.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFix = async () => {
    if (!layout || violations.length === 0) return;
    setIsGenerating(true);
    setError(null);
    try {
      const fixedLayout = await fixLayoutViolations(layout, violations);
      setLayout(fixedLayout);
      const remainingViolations = validateLayout(fixedLayout);
      setViolations(remainingViolations);
      
      if (remainingViolations.length === 0) {
        // Success
      } else if (remainingViolations.length < violations.length) {
        setError(`Partial fix: Reduced violations from ${violations.length} to ${remainingViolations.length}.`);
      } else {
        setError("AI could not fully resolve the spatial constraints.");
      }
    } catch (e: any) {
      setError("Failed to fix layout: " + e.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col p-4 min-w-0">
        <header className="mb-4 flex items-center justify-between">
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">
                    <span className="text-blue-500">P</span>arking
                    <span className="text-blue-500">V</span>iz
                </h1>
                <p className="text-slate-400 text-sm">Semantic Layout & Constraint Analyzer</p>
            </div>
            <div className="flex gap-4 text-xs text-slate-500">
               <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span> React 19</div>
               <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500"></span> D3.js</div>
               <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500"></span> Gemini 2.5</div>
            </div>
        </header>

        {error && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-200 px-4 py-2 rounded mb-4 text-sm flex items-center justify-between">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="hover:bg-red-500/20 p-1 rounded">✕</button>
            </div>
        )}

        <main className="flex-1 min-h-0 relative">
            {layout ? (
                <MapRenderer layout={layout} violations={violations} />
            ) : (
                <div className="w-full h-full flex items-center justify-center border border-slate-800 rounded-lg bg-slate-900/50">
                    <div className="text-center text-slate-500">
                        <p>No layout loaded.</p>
                        <p className="text-sm">Upload a JSON file or use the Generator.</p>
                    </div>
                </div>
            )}
        </main>
      </div>

      {/* Sidebar Controls */}
      <LayoutControl 
        onUpload={handleUpload} 
        onGenerate={handleGenerate} 
        onAugment={handleAugment}
        onFix={handleFix}
        isGenerating={isGenerating}
        violations={violations}
        hasLayout={!!layout}
      />
    </div>
  );
};

export default App;