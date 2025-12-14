import React, { useEffect } from 'react';
import MapRenderer from './components/MapRenderer';
import LayoutControl from './components/LayoutControl';
import { generateParkingLayout, augmentLayoutWithRoads } from './services/geminiService';
import { useStore } from './store';
import { validateLayout } from './utils/geometry';

const App: React.FC = () => {
  // Global State
  const { 
    layout, violations, isGenerating, error, logs, generationTime,
    setLayout, setViolations, setIsGenerating, setError, addLog, setGenerationTime, clearLogs 
  } = useStore();

  const handleGenerate = async (prompt: string) => {
    setIsGenerating(true);
    setError(null);
    clearLogs();
    setGenerationTime(null);
    const startTime = Date.now();
    
    try {
      const newLayout = await generateParkingLayout(prompt, addLog);
      setLayout(newLayout);
      setViolations([]); 
      addLog("Generation complete.");
    } catch (e) {
      setError("Failed to generate layout.");
    } finally {
      setIsGenerating(false);
      setGenerationTime((Date.now() - startTime) / 1000);
    }
  };

  const handleRefine = async () => {
    if (!layout) return;
    setIsGenerating(true);
    addLog("--- Refinement ---");
    const startTime = Date.now();
    
    try {
      const augmented = await augmentLayoutWithRoads(layout, addLog);
      if (augmented && augmented.elements.length > 0) {
        setLayout(augmented);
        setViolations([]);
        addLog("Refinement complete.");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsGenerating(false);
      setGenerationTime((Date.now() - startTime) / 1000);
    }
  };

  const handleDownload = () => {
      if (!layout) return;
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(layout, null, 2));
      const a = document.createElement('a');
      a.href = dataStr;
      a.download = "parking_layout.json";
      a.click();
      a.remove();
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans">
      <div className="flex-1 flex flex-col p-4 min-w-0">
        <header className="mb-4 flex items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tight text-white">
                <span className="text-blue-500">P</span>arking<span className="text-purple-500">V</span>iz
            </h1>
            <div className="flex gap-4 text-xs text-slate-500">
               <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span> Coarse</div>
               <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500"></span> Fine</div>
            </div>
        </header>

        {error && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-200 px-4 py-2 rounded mb-4 text-sm flex justify-between">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="hover:bg-red-500/20 px-2 rounded">✕</button>
            </div>
        )}

        <main className="flex-1 min-h-0 relative">
            {layout ? <MapRenderer /> : (
                <div className="w-full h-full flex items-center justify-center border border-slate-800 rounded-lg bg-slate-900/50">
                    <p className="text-slate-500 text-sm">Enter prompt and Generate Structure.</p>
                </div>
            )}
        </main>
      </div>

      <LayoutControl 
        onGenerate={handleGenerate} 
        onRefine={handleRefine}
        onDownload={handleDownload}
      />
    </div>
  );
};

export default App;