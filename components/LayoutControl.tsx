import React, { useState } from 'react';
import { ConstraintViolation } from '../types';
import { Upload, AlertTriangle, CheckCircle, BrainCircuit, FileJson, Sparkles } from 'lucide-react';

interface LayoutControlProps {
  onUpload: (json: string) => void;
  onGenerate: (prompt: string) => void;
  onAugment: () => void;
  isGenerating: boolean;
  violations: ConstraintViolation[];
  hasLayout: boolean;
}

const LayoutControl: React.FC<LayoutControlProps> = ({ 
  onUpload, 
  onGenerate, 
  onAugment,
  isGenerating, 
  violations,
  hasLayout 
}) => {
  const [prompt, setPrompt] = useState("Small commercial parking lot with spaces, a main central road, and an entrance on the left.");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          onUpload(ev.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="w-full md:w-80 flex-shrink-0 bg-slate-900 border-l border-slate-800 p-4 overflow-y-auto flex flex-col gap-6">
      
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <FileJson className="w-5 h-5 text-blue-400" />
            Config & Data
        </h2>
        <p className="text-xs text-slate-400 mt-1">Manage parking layout data source.</p>
      </div>

      {/* Upload Section */}
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-300 block">Upload JSON Layout</label>
        <div className="relative group">
          <input 
            type="file" 
            accept=".json" 
            onChange={handleFileChange}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
          />
          <div className="border-2 border-dashed border-slate-700 rounded-lg p-4 flex flex-col items-center justify-center text-slate-400 group-hover:border-blue-500 group-hover:text-blue-400 transition-colors">
            <Upload className="w-6 h-6 mb-2" />
            <span className="text-xs">Click to upload JSON</span>
          </div>
        </div>
      </div>

      <div className="h-px bg-slate-800" />

      {/* Augmentation Section */}
      {hasLayout && (
         <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                AI Auto-Completion
            </label>
            <p className="text-xs text-slate-400">
                Detect empty spaces and add logical Roads & pedestrian path.
            </p>
            <button
                onClick={onAugment}
                disabled={isGenerating}
                className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-sm font-medium py-2 px-4 rounded transition-colors flex items-center justify-center gap-2"
            >
                {isGenerating ? "Processing..." : "✨ Auto-Connect Roads"}
            </button>
         </div>
      )}

      <div className="h-px bg-slate-800" />

      {/* Generation Section */}
      <div className="space-y-3">
        <label className="text-sm font-semibold text-slate-300 flex items-center gap-2">
           <BrainCircuit className="w-4 h-4 text-purple-400" />
           New Layout Generator
        </label>
        <textarea 
          className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-purple-500 h-24 resize-none"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe your parking lot..."
        />
        <button 
          onClick={() => onGenerate(prompt)}
          disabled={isGenerating}
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium py-2 px-4 rounded transition-colors flex items-center justify-center gap-2"
        >
          {isGenerating ? (
              <span className="animate-pulse">Generating...</span>
          ) : (
              <>Generate Layout</>
          )}
        </button>
      </div>

      <div className="h-px bg-slate-800" />

      {/* Report Section */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-300">Constraint Report</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${violations.length > 0 ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                {violations.length} Issues
            </span>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {violations.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">No spatial violations detected.</p>
                </div>
            ) : (
                violations.map((v, idx) => (
                    <div key={idx} className="bg-red-950/30 border border-red-900/50 p-2 rounded text-xs text-red-200">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0 text-red-500" />
                            <div>
                                <strong className="block text-red-400 mb-0.5 capitalize">{v.type.replace('_', ' ')}</strong>
                                {v.message}
                            </div>
                        </div>
                    </div>
                ))
            )}
        </div>
      </div>

    </div>
  );
};

export default LayoutControl;