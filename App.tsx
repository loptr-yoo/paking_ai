import React, { useState, useEffect } from 'react';
import MapRenderer from './components/MapRenderer';
import LayoutControl from './components/LayoutControl';
import { ParkingLayout, ConstraintViolation, ElementType } from './types';
import { validateLayout } from './utils/geometry';
import { generateParkingLayout, augmentLayoutWithRoads } from './services/geminiService';

const App: React.FC = () => {
  const [layout, setLayout] = useState<ParkingLayout | null>(null);
  const [violations, setViolations] = useState<ConstraintViolation[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [generationTime, setGenerationTime] = useState<number | null>(null);

  // Initial Demo Data load
  useEffect(() => {
    // Trigger a default generation for demo purposes on load
    handleGenerate("Default demo layout");
  }, []);

  const handleLog = (msg: string) => {
      setLogs(prev => [...prev, msg]);
  };

  const handleGenerate = async (prompt: string) => {
    setIsGenerating(true);
    setError(null);
    setLogs([]); // Clear logs on new run
    setGenerationTime(null);
    const startTime = Date.now();
    
    try {
      // Step 1: Coarse Generation
      const newLayout = await generateParkingLayout(prompt, handleLog);
      setLayout(newLayout);
      // Suppress visual errors on completion (User wants clean layout despite logs)
      setViolations([]); 
      handleLog("Generation complete. Visualizing results...");
    } catch (e) {
      setError("Failed to generate layout.");
      console.error(e);
    } finally {
      setIsGenerating(false);
      const endTime = Date.now();
      setGenerationTime((endTime - startTime) / 1000);
    }
  };

  const handleRefine = async () => {
    if (!layout) return;
    setIsGenerating(true);
    setLogs(prev => [...prev, "--- Starting Refinement ---"]);
    setGenerationTime(null);
    const startTime = Date.now();
    
    try {
      // Step 2: Fine-grained Augmentation
      const augmentedLayout = await augmentLayoutWithRoads(layout, handleLog);
      if (augmentedLayout && augmentedLayout.elements && augmentedLayout.elements.length > 0) {
        setLayout(augmentedLayout);
        // Suppress visual errors on completion
        setViolations([]);
        handleLog("Refinement complete. Visualizing results...");
      } else {
        setError("AI could not identify valid refinements.");
      }
    } catch (e: any) {
      setError("Failed to refine layout: " + e.message);
    } finally {
      setIsGenerating(false);
      const endTime = Date.now();
      setGenerationTime((endTime - startTime) / 1000);
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
                    <span className="text-purple-500">V</span>iz
                </h1>
                <p className="text-slate-400 text-sm">Semantic Layout & Constraint Analyzer</p>
            </div>
            <div className="flex gap-4 text-xs text-slate-500">
               <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span> Coarse</div>
               <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500"></span> Fine</div>
               <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500"></span> Gemini 3 Pro</div>
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
                        <p className="text-sm">Enter a description and click "Generate Structure".</p>
                    </div>
                </div>
            )}
        </main>
      </div>

      {/* Sidebar Controls */}
      <LayoutControl 
        onGenerate={handleGenerate} 
        onRefine={handleRefine}
        isGenerating={isGenerating}
        violations={violations}
        hasLayout={!!layout}
        logs={logs}
        generationTime={generationTime}
      />
    </div>
  );
};

export default App;