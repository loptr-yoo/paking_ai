import React, { useState } from 'react';
import { ConstraintViolation } from '../types';
import { BrainCircuit, Sparkles, Terminal, CheckCircle, AlertTriangle, Layers, Map as MapIcon, Clock, Download } from 'lucide-react';

interface LayoutControlProps {
  onGenerate: (prompt: string) => void;
  onRefine: () => void;
  onDownload: () => void;
  isGenerating: boolean;
  violations: ConstraintViolation[];
  hasLayout: boolean;
  logs?: string[];
  generationTime?: number | null;
}

const LayoutControl: React.FC<LayoutControlProps> = ({ 
  onGenerate, 
  onRefine, 
  onDownload,
  isGenerating, 
  violations,
  hasLayout,
  logs = [],
  generationTime
}) => {
  const [prompt, setPrompt] = useState("Small commercial parking lot with spaces, a main central road, and an entrance on the left.");

  return (
    <div className="w-full md:w-80 flex-shrink-0 bg-slate-900 border-l border-slate-800 p-4 overflow-y-auto flex flex-col gap-6">
      
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-400" />
            Control Panel
        </h2>
        <p className="text-xs text-slate-400 mt-1">Semantic Parking Generator</p>
      </div>

      {/* Input Section */}
      <div className="space-y-3">
        <label className="text-sm font-semibold text-slate-300">Description</label>
        <textarea 
          className="w-full bg-slate-800 border border-slate-700 rounded p-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500 h-32 resize-none leading-relaxed"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the parking lot layout (e.g., L-shaped, 2 entrances, heavy capacity)..."
        />
        
        <div className="grid grid-cols-1 gap-3">
            {/* Step 1: Coarse Generation */}
            <button 
                onClick={() => onGenerate(prompt)}
                disabled={isGenerating}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold py-3 px-4 rounded-lg transition-all shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2"
            >
                {isGenerating && !hasLayout ? (
                    <span className="animate-pulse">Generating...</span>
                ) : (
                    <>
                        <MapIcon className="w-4 h-4" />
                        Generate Structure
                        <span className="text-[10px] opacity-70 bg-black/20 px-1.5 py-0.5 rounded ml-1">Coarse</span>
                    </>
                )}
            </button>

            {/* Step 2: Fine Refinement */}
            <button 
                onClick={onRefine}
                disabled={isGenerating || !hasLayout}
                className={`w-full border-2 text-sm font-bold py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2
                    ${!hasLayout 
                        ? 'border-slate-700 text-slate-500 cursor-not-allowed bg-slate-800/50' 
                        : 'border-purple-500/50 bg-purple-900/20 text-purple-300 hover:bg-purple-900/40 hover:border-purple-400 shadow-lg shadow-purple-900/10'
                    }`}
            >
                {isGenerating && hasLayout ? (
                    <span className="animate-pulse">Refining...</span>
                ) : (
                    <>
                        <Sparkles className="w-4 h-4" />
                        Refine Details
                        <span className="text-[10px] opacity-70 bg-purple-500/20 px-1.5 py-0.5 rounded ml-1">Fine</span>
                    </>
                )}
            </button>

            {/* Step 3: Download */}
            <button
                onClick={onDownload}
                disabled={!hasLayout || isGenerating}
                className={`w-full border border-slate-700 text-sm font-medium py-2.5 px-4 rounded-lg transition-all flex items-center justify-center gap-2 ${!hasLayout || isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-800 text-slate-300'}`}
            >
                <Download className="w-4 h-4" />
                Download JSON
            </button>
        </div>
      </div>

      <div className="h-px bg-slate-800 my-2" />

      {/* Report Section */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-300">Status Report</h3>
            <div className="flex items-center gap-2">
                {generationTime !== null && (
                    <span className="text-xs text-slate-400 flex items-center gap-1 bg-slate-800 px-1.5 py-0.5 rounded">
                        <Clock className="w-3 h-3" /> {generationTime.toFixed(1)}s
                    </span>
                )}
                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${violations.length > 0 ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                    {violations.length > 0 ? `${violations.length} Issues` : 'Ready'}
                </span>
            </div>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            {/* Logs Area */}
            {logs.length > 0 && (
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 mb-3 shadow-inner">
                    <div className="flex items-center gap-1.5 text-xs text-blue-400 font-bold mb-2 pb-2 border-b border-slate-800">
                        <Terminal className="w-3 h-3" /> Process Log
                    </div>
                    {logs.map((log, i) => (
                        <div key={i} className="text-[10px] text-slate-400 font-mono mb-1.5 last:mb-0 leading-relaxed">
                            <span className="text-slate-600 mr-2">{'>'}</span>{log}
                        </div>
                    ))}
                    {isGenerating && (
                        <div className="text-[10px] text-blue-400 font-mono animate-pulse mt-2">
                            <span className="text-blue-600 mr-2">{'>'}</span> Processing...
                        </div>
                    )}
                </div>
            )}

            {/* Violations Area */}
            {violations.length === 0 ? (
                hasLayout && (
                    <div className="text-center py-6 text-slate-500 bg-slate-800/30 rounded-lg border border-slate-800/50">
                        <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500/50" />
                        <p className="text-xs font-medium text-green-400/80">Layout Validated</p>
                        <p className="text-[10px] mt-1">No spatial violations detected.</p>
                    </div>
                )
            ) : (
                <div className="space-y-2">
                    {violations.map((v, idx) => (
                        <div key={idx} className="bg-red-950/20 border-l-2 border-red-500 p-2 pl-3 rounded-r text-xs text-red-200/80">
                            <div className="flex items-start gap-2">
                                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0 text-red-500" />
                                <div>
                                    <strong className="block text-red-400 mb-0.5 capitalize tracking-wide">{v.type.replace('_', ' ')}</strong>
                                    {v.message}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
      </div>

    </div>
  );
};

export default LayoutControl;