import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Compass,
  Copy,
  FileText,
  FlaskConical,
  HelpCircle,
  Loader2,
  MessageSquare,
  RefreshCw,
  Target,
  Terminal,
  X,
} from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { useUIStore } from '../store/useUIStore';
import type {
  DocumentJob,
  LearningWorld,
  StructuredStudyNotes,
  StudyDocument,
  Topic,
} from '../types/api';

interface DocumentAnalysis {
  summary: string;
  learning_objectives: string[];
  study_notes: StructuredStudyNotes | null;
  analysis_version?: string;
  model: string;
}

interface ChunkPreview {
  id: string;
  chunk_index: number;
  source_kind: string;
  source_start: number;
  heading_path: string;
  token_estimate: number;
  preview: string;
}

interface DocumentDetailResponse {
  document: StudyDocument;
  job: DocumentJob | null;
  analysis: DocumentAnalysis | null;
  topics: Topic[];
  chunks: ChunkPreview[];
}

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable in non-HTTPS iframe contexts
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#151E33] hover:bg-[#1B2740] border border-slate-400/20 text-[11px] font-medium text-[#94A3B8] hover:text-[#F8FAFC] transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-[#22C55E]" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  const [activeTab, setActiveTab] = useState<'notes' | 'topics' | 'chunks'>('notes');
  const [expandedExps, setExpandedExps] = useState<Set<number>>(() => new Set([0, 1]));
  const [selectedChunk, setSelectedChunk] = useState<{
    document_title: string;
    chunk: { id: string; source_kind: string; source_start: number; heading_path: string; content: string };
  } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['document-detail', id],
    queryFn: () => apiFetch<DocumentDetailResponse>(`/api/documents/${id}`),
    enabled: Boolean(id),
    refetchInterval: (q) => {
      const st = q.state.data?.document.status;
      return st === 'uploaded' || st === 'processing' ? 1500 : false;
    },
  });

  const reprocessMut = useMutation({
    mutationFn: () =>
      apiFetch(`/api/documents/${id}/reprocess`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['document-detail', id] });
      addToast('success', 'Reprocessing started with updated study-note analyzer.');
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Unable to reprocess document.');
    },
  });

  const startQuizMut = useMutation({
    mutationFn: () =>
      apiFetch<{ assessment: { id: string } }>('/api/assessments', {
        method: 'POST',
        body: JSON.stringify({ kind: 'diagnostic', document_id: id, question_count: 5 }),
      }),
    onSuccess: (res) => {
      navigate(`/assessments/${res.assessment.id}`);
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Unable to launch quiz.');
    },
  });

  const generateWorldMut = useMutation({
    mutationFn: () =>
      apiFetch<{ world: LearningWorld }>('/api/worlds/generate', {
        method: 'POST',
        body: JSON.stringify({ document_id: id }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['worlds'] });
      addToast('success', 'Learning World ready!');
      navigate('/worlds');
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Unable to generate Learning World.');
    },
  });

  const openCitationChunk = async (chunkId?: string) => {
    if (!chunkId || !id) return;
    try {
      const res = await apiFetch<{
        document_title: string;
        chunk: { id: string; source_kind: string; source_start: number; heading_path: string; content: string };
      }>(`/api/documents/${id}/chunks/${chunkId}`);
      setSelectedChunk(res);
    } catch {
      addToast('error', 'Could not load source excerpt.');
    }
  };

  const toggleExp = (idx: number) => {
    setExpandedExps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-28 rounded-2xl bg-[#151E33] border border-slate-400/10" />
        <div className="h-64 rounded-2xl bg-[#151E33] border border-slate-400/10" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="eq-card rounded-2xl p-8 text-center space-y-3">
        <p className="text-sm text-[#EF4444]">Study document could not be loaded.</p>
        <Link to="/documents" className="text-xs font-semibold text-[#22D3EE] hover:underline">
          Back to Study Library
        </Link>
      </div>
    );
  }

  const { document: doc, analysis, topics, chunks } = data;
  const studyNotes = analysis?.study_notes || null;
  const topTopics = topics.filter((t) => t.kind === 'topic');
  const childTopicsMap = new Map<string, Topic[]>();
  topics.forEach((t) => {
    if (t.parent_id) {
      const list = childTopicsMap.get(t.parent_id) || [];
      list.push(t);
      childTopicsMap.set(t.parent_id, list);
    }
  });

  const displayTopicCount = topTopics.length > 0 ? topTopics.length : topics.length;
  const isUnsuitable = Boolean(studyNotes?.unsuitable_reason);

  return (
    <div className="space-y-6">
      <div className="eq-hero-surface rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="space-y-2 min-w-0">
          <Link
            to="/documents"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Study Library
          </Link>
          <h1 className="font-display text-2xl font-bold text-[#F8FAFC] truncate">{doc.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#94A3B8] uppercase tabular-nums">
            <span className="px-2 py-0.5 rounded bg-[#0B1020]/70 border border-slate-400/15 font-mono text-[#F8FAFC]">
              {doc.file_ext}
            </span>
            <span>·</span>
            <span className={doc.status === 'ready' ? 'text-[#22C55E] font-semibold' : 'text-[#F59E0B] font-semibold'}>
              {doc.status}
            </span>
            <span>·</span>
            <span>{chunks.length} cleaned sections</span>
            <span>·</span>
            <span>{displayTopicCount} core topics</span>
          </div>
        </div>

        {doc.status === 'ready' && (
          <div className="flex flex-wrap gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => startQuizMut.mutate()}
              disabled={startQuizMut.isPending || isUnsuitable || topics.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-xs font-semibold transition-colors whitespace-nowrap"
            >
              {startQuizMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
              Launch Diagnostic Quiz
            </button>
            <button
              type="button"
              onClick={() => generateWorldMut.mutate()}
              disabled={generateWorldMut.isPending || isUnsuitable || topics.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#11182B] hover:bg-[#1B2740] disabled:opacity-50 border border-slate-400/20 text-xs font-semibold text-[#F8FAFC] transition-colors whitespace-nowrap"
            >
              <Compass className="w-3.5 h-3.5 text-[#22D3EE]" />
              Open Learning World
            </button>
            <Link
              to={`/tutor?doc=${doc.id}`}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/20 text-xs font-semibold text-[#F8FAFC] transition-colors whitespace-nowrap"
            >
              <MessageSquare className="w-3.5 h-3.5 text-[#22C55E]" />
              Ask Tutor
            </Link>
            <button
              type="button"
              onClick={() => reprocessMut.mutate()}
              disabled={reprocessMut.isPending}
              title="Refresh extracted notes and topics"
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/20 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reprocessMut.isPending ? 'animate-spin' : ''}`} />
              Re-analyze
            </button>
          </div>
        )}
      </div>

      {doc.status === 'failed' && (
        <div className="p-4 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-sm text-[#EF4444]">
          {doc.error_code ? `[${doc.error_code}] ` : ''}
          {doc.error_message_safe || 'Document processing failed.'}
        </div>
      )}

      {isUnsuitable && studyNotes?.unsuitable_reason && (
        <div className="p-5 rounded-2xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 flex items-start gap-3 text-sm text-[#F8FAFC]">
          <AlertTriangle className="w-5 h-5 text-[#F59E0B] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-[#F59E0B]">Insufficient Educational Content Detected</p>
            <p className="text-xs text-[#94A3B8] leading-relaxed">{studyNotes.unsuitable_reason}</p>
          </div>
        </div>
      )}

      {/* Summary & Objectives */}
      {analysis && (
        <div className="eq-card rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-[#F8FAFC]">
              Document Summary & Learning Objectives
            </h2>
            <span className="text-xs font-medium text-[#22D3EE]">
              {studyNotes?.kind === 'practical' ? 'Practical Lab Format' : 'Theory & Concepts Format'}
            </span>
          </div>
          <p className="text-sm text-[#F8FAFC]/90 leading-relaxed">{analysis.summary}</p>
          {analysis.learning_objectives.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-slate-400/15">
              <p className="text-xs font-semibold text-[#22D3EE] uppercase tracking-wide">
                Key Learning Objectives
              </p>
              <ul className="space-y-1.5 text-sm text-[#94A3B8] list-disc list-inside">
                {analysis.learning_objectives.map((obj, idx) => (
                  <li key={idx} className="leading-relaxed">
                    {obj}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-400/15 pb-3">
        {[
          { key: 'notes' as const, label: 'Structured Study Notes', icon: BookOpen },
          { key: 'topics' as const, label: `Knowledge Map (${displayTopicCount})`, icon: FlaskConical },
          { key: 'chunks' as const, label: `Source Excerpts (${chunks.length})`, icon: FileText },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                active
                  ? 'bg-[#8B5CF6] text-white shadow-sm'
                  : 'bg-[#11182B] border border-slate-400/15 text-[#94A3B8] hover:text-[#F8FAFC]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: STRUCTURED STUDY NOTES */}
      {activeTab === 'notes' && (
        <div className="space-y-5">
          {!studyNotes ? (
            <div className="eq-card rounded-2xl p-6 text-sm text-[#94A3B8] flex flex-wrap items-center justify-between gap-4">
              <span>Structured study notes are not yet generated for this document.</span>
              <button
                type="button"
                onClick={() => reprocessMut.mutate()}
                disabled={reprocessMut.isPending}
                className="px-4 py-2 rounded-xl bg-[#8B5CF6] text-white text-xs font-semibold"
              >
                Generate Study Notes
              </button>
            </div>
          ) : studyNotes.kind === 'practical' && studyNotes.practical_experiments.length > 0 ? (
            <div className="space-y-5">
              {/* General Instructions */}
              {studyNotes.general_instructions.length > 0 && (
                <div className="eq-card rounded-2xl p-5 space-y-2.5">
                  <h3 className="font-display text-sm font-semibold text-[#22D3EE] uppercase tracking-wide">
                    General Lab Guidelines
                  </h3>
                  <ul className="grid sm:grid-cols-2 gap-2 text-xs text-[#94A3B8]">
                    {studyNotes.general_instructions.map((inst, idx) => (
                      <li key={idx} className="flex items-start gap-2 leading-relaxed">
                        <span className="text-[#8B5CF6] font-bold">•</span>
                        <span>{inst}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Expand/Collapse Controls */}
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold text-[#F8FAFC]">
                  Experiments & Practical Notes ({studyNotes.practical_experiments.length})
                </h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedExps(new Set(studyNotes.practical_experiments.map((_, i) => i)))
                    }
                    className="px-3 py-1.5 rounded-lg bg-[#11182B] border border-slate-400/15 text-xs text-[#94A3B8] hover:text-[#F8FAFC]"
                  >
                    Expand All
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedExps(new Set())}
                    className="px-3 py-1.5 rounded-lg bg-[#11182B] border border-slate-400/15 text-xs text-[#94A3B8] hover:text-[#F8FAFC]"
                  >
                    Collapse All
                  </button>
                </div>
              </div>

              {/* Practical Experiments Accordion */}
              <div className="space-y-4">
                {studyNotes.practical_experiments.map((exp, idx) => {
                  const isOpen = expandedExps.has(idx);
                  return (
                    <div key={idx} className="eq-card rounded-2xl overflow-hidden border border-slate-400/15">
                      <button
                        type="button"
                        onClick={() => toggleExp(idx)}
                        className="w-full px-5 py-4 flex items-center justify-between gap-4 text-left hover:bg-[#1B2740]/40 transition-colors"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-0.5 rounded-md bg-[#8B5CF6]/20 text-[#C4B5FD] text-[11px] font-semibold">
                              Exp {exp.number}
                            </span>
                            <span className="text-xs text-[#22D3EE]">{exp.source_ref}</span>
                          </div>
                          <h4 className="font-display text-base font-semibold text-[#F8FAFC]">
                            {exp.title}
                          </h4>
                          {exp.aim && (
                            <p className="text-xs text-[#94A3B8] line-clamp-2">
                              <strong className="text-[#F8FAFC]">Aim:</strong> {exp.aim}
                            </p>
                          )}
                        </div>
                        {isOpen ? (
                          <ChevronUp className="w-5 h-5 text-[#94A3B8] shrink-0" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-[#94A3B8] shrink-0" />
                        )}
                      </button>

                      {isOpen && (
                        <div className="px-5 pb-5 pt-2 border-t border-slate-400/15 space-y-4">
                          {exp.aim && (
                            <div className="p-3.5 rounded-xl bg-[#11182B] border border-[#8B5CF6]/25 text-xs leading-relaxed text-[#F8FAFC]">
                              <span className="font-semibold text-[#C4B5FD] uppercase tracking-wide mr-1.5">
                                Aim:
                              </span>
                              {exp.aim}
                            </div>
                          )}

                          {exp.theory && (
                            <div className="space-y-1">
                              <p className="text-xs font-semibold text-[#22D3EE] uppercase tracking-wide">
                                Key Theory & Concept
                              </p>
                              <p className="text-sm text-[#94A3B8] leading-relaxed">{exp.theory}</p>
                            </div>
                          )}

                          {exp.subtopics.length > 0 && (
                            <div className="space-y-3">
                              {exp.subtopics.map((sub, sIdx) => (
                                <div
                                  key={sIdx}
                                  className="p-4 rounded-xl bg-[#11182B] border border-slate-400/15 space-y-3"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h5 className="font-display text-sm font-semibold text-[#F8FAFC]">
                                      {sub.title}
                                    </h5>
                                    <span className="text-[11px] text-[#94A3B8]">{sub.source_ref}</span>
                                  </div>

                                  {sub.theory && (
                                    <p className="text-xs text-[#94A3B8] leading-relaxed">{sub.theory}</p>
                                  )}

                                  {sub.code && (
                                    <div className="rounded-xl bg-[#0B1020] border border-slate-400/15 overflow-hidden">
                                      <div className="px-3.5 py-2 border-b border-slate-400/10 flex items-center justify-between">
                                        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#22D3EE]">
                                          <Code2 className="w-3.5 h-3.5" />
                                          Program / Syntax
                                        </span>
                                        <CopyCodeButton code={sub.code} />
                                      </div>
                                      <pre className="p-3.5 text-xs font-mono text-[#F8FAFC]/95 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                                        {sub.code}
                                      </pre>
                                    </div>
                                  )}

                                  {sub.sample_output && (
                                    <div className="rounded-xl bg-[#0B1020]/70 border border-[#22C55E]/20 p-3 space-y-1">
                                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#22C55E] uppercase tracking-wide">
                                        <Terminal className="w-3 h-3" />
                                        Sample Output
                                      </span>
                                      <pre className="text-xs font-mono text-[#94A3B8] whitespace-pre-wrap leading-relaxed">
                                        {sub.sample_output}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {exp.comparisons.map((comp, cIdx) => (
                            <div key={cIdx} className="space-y-2">
                              <p className="text-xs font-semibold text-[#22D3EE]">{comp.title}</p>
                              <div className="overflow-x-auto rounded-xl border border-slate-400/15">
                                <table className="w-full text-xs text-left">
                                  <thead className="bg-[#11182B] text-[#F8FAFC]">
                                    <tr>
                                      {comp.headers.map((h, hIdx) => (
                                        <th key={hIdx} className="px-3.5 py-2.5 font-semibold border-b border-slate-400/15">
                                          {h}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-400/10 text-[#94A3B8]">
                                    {comp.rows.map((r, rIdx) => (
                                      <tr key={rIdx}>
                                        <td className="px-3.5 py-2">{r[0]}</td>
                                        <td className="px-3.5 py-2">{r[1]}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}

                          {exp.key_points.length > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-xs font-semibold text-[#F8FAFC]">Key Takeaways</p>
                              <ul className="space-y-1 text-xs text-[#94A3B8] list-disc list-inside">
                                {exp.key_points.map((kp, kIdx) => (
                                  <li key={kIdx}>{kp}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {exp.result && (
                            <div className="p-3.5 rounded-xl bg-[#22C55E]/10 border border-[#22C55E]/25 text-xs text-[#F8FAFC] leading-relaxed">
                              <span className="font-semibold text-[#22C55E] uppercase tracking-wide mr-1.5">
                                Result:
                              </span>
                              {exp.result}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Important Commands & Operators */}
              {studyNotes.commands_reference.length > 0 && (
                <div className="eq-card rounded-2xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-[#22D3EE]" />
                    <h3 className="font-display text-base font-semibold text-[#F8FAFC]">
                      Essential Commands & Operators Reference
                    </h3>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2.5">
                    {studyNotes.commands_reference.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-[#11182B] border border-slate-400/15 flex items-start gap-3"
                      >
                        <code className="px-2 py-0.5 rounded bg-[#0B1020] text-[#22D3EE] text-xs font-mono font-semibold shrink-0">
                          {item.command}
                        </code>
                        <span className="text-xs text-[#94A3B8] leading-relaxed">{item.purpose}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested Viva Questions */}
              {studyNotes.viva_questions.length > 0 && (
                <div className="eq-card rounded-2xl p-6 space-y-3">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 text-[#F59E0B]" />
                    <h3 className="font-display text-base font-semibold text-[#F8FAFC]">
                      Important Viva & Review Questions
                    </h3>
                  </div>
                  <ol className="space-y-2 text-sm text-[#94A3B8] list-decimal list-inside">
                    {studyNotes.viva_questions.map((vq, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {vq}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          ) : (
            /* Theory Notes Format */
            <div className="space-y-4">
              {studyNotes.theory_sections.map((sec, idx) => (
                <div key={idx} className="eq-card rounded-2xl p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-lg font-semibold text-[#F8FAFC]">{sec.title}</h3>
                    <span className="text-xs text-[#22D3EE]">{sec.source_ref}</span>
                  </div>

                  {sec.introduction && (
                    <p className="text-sm text-[#F8FAFC]/90 leading-relaxed">{sec.introduction}</p>
                  )}

                  {sec.definitions.length > 0 && (
                    <div className="p-4 rounded-xl bg-[#11182B] border border-slate-400/15 space-y-2">
                      <p className="text-xs font-semibold text-[#22D3EE] uppercase tracking-wide">
                        Key Definitions
                      </p>
                      <ul className="space-y-1.5 text-xs text-[#F8FAFC]/90 list-disc list-inside">
                        {sec.definitions.map((d, i) => (
                          <li key={i} className="leading-relaxed">
                            {d}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {sec.key_concepts.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-[#F8FAFC] uppercase tracking-wide">
                        Core Concepts
                      </p>
                      <ul className="space-y-1 text-xs text-[#94A3B8] list-disc list-inside">
                        {sec.key_concepts.map((c, i) => (
                          <li key={i} className="leading-relaxed">
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {sec.formulas.length > 0 && (
                    <div className="p-3.5 rounded-xl bg-[#11182B] border border-slate-400/15 font-mono text-xs text-[#F59E0B] space-y-1">
                      {sec.formulas.map((f, i) => (
                        <div key={i}>{f}</div>
                      ))}
                    </div>
                  )}

                  {sec.examples.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-[#22C55E] uppercase tracking-wide">
                        Examples & Applications
                      </p>
                      {sec.examples.map((ex, i) => (
                        <p key={i} className="text-xs text-[#94A3B8] pl-3 border-l-2 border-[#22C55E]/40 leading-relaxed">
                          {ex}
                        </p>
                      ))}
                    </div>
                  )}

                  {sec.quick_revision.length > 0 && (
                    <div className="p-3.5 rounded-xl bg-[#8B5CF6]/10 border border-[#8B5CF6]/25 space-y-1">
                      <p className="text-xs font-semibold text-[#C4B5FD] uppercase tracking-wide">
                        Quick Revision Points
                      </p>
                      <ul className="space-y-1 text-xs text-[#F8FAFC]/90 list-disc list-inside">
                        {sec.quick_revision.map((qr, i) => (
                          <li key={i}>{qr}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: EXTRACTED KNOWLEDGE MAP */}
      {activeTab === 'topics' && (
        <div className="space-y-4">
          {topics.length === 0 ? (
            <div className="eq-card rounded-2xl p-6 text-sm text-[#94A3B8]">
              {doc.status === 'ready'
                ? 'No structured topics were extracted from this file.'
                : 'Topics will appear here once processing completes.'}
            </div>
          ) : (
            <div className="grid gap-4">
              {(topTopics.length > 0 ? topTopics : topics).map((topic) => {
                const children = childTopicsMap.get(topic.id) || [];
                return (
                  <div key={topic.id} className="eq-card eq-card-hover rounded-2xl p-5 space-y-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-display text-base font-semibold text-[#F8FAFC]">
                          {topic.name}
                        </h3>
                        <p className="text-xs text-[#94A3B8] capitalize mt-0.5">
                          {topic.kind} · {topic.difficulty}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {topic.source_refs.map((ref, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => void openCitationChunk(ref.chunk_id)}
                            className="px-2.5 py-1 rounded-lg bg-[#11182B] hover:bg-[#1B2740] border border-[#22D3EE]/30 text-xs font-medium text-[#22D3EE] transition-colors"
                          >
                            {ref.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {topic.summary && (
                      <p className="text-sm text-[#94A3B8] leading-relaxed">{topic.summary}</p>
                    )}

                    {topic.definition && topic.definition !== topic.summary && (
                      <div className="p-3.5 rounded-xl bg-[#11182B] border border-slate-400/15 text-xs text-[#F8FAFC]/90 leading-relaxed">
                        <span className="font-semibold text-[#22D3EE]">Key Principle: </span>
                        {topic.definition}
                      </div>
                    )}

                    {topic.formulas.length > 0 && (
                      <div className="p-3.5 rounded-xl bg-[#11182B] border border-slate-400/15 text-xs font-mono text-[#F59E0B] space-y-1">
                        {topic.formulas.map((f, idx) => (
                          <div key={idx}>{f}</div>
                        ))}
                      </div>
                    )}

                    {children.length > 0 && (
                      <div className="pt-3 border-t border-slate-400/15 grid sm:grid-cols-2 gap-2.5">
                        {children.map((sub) => (
                          <div
                            key={sub.id}
                            className="p-3.5 rounded-xl bg-[#11182B] border border-slate-400/15 space-y-1"
                          >
                            <p className="text-xs font-semibold text-[#F8FAFC]">{sub.name}</p>
                            <p className="text-xs text-[#94A3B8] line-clamp-2 leading-relaxed">{sub.summary}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: SOURCE EXCERPTS */}
      {activeTab === 'chunks' && (
        <div className="space-y-3">
          {chunks.length === 0 ? (
            <div className="eq-card rounded-2xl p-6 text-sm text-[#94A3B8]">
              No cleaned source excerpts available for this document.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {chunks.map((chunk) => (
                <button
                  key={chunk.id}
                  type="button"
                  onClick={() => void openCitationChunk(chunk.id)}
                  className="eq-card eq-card-hover text-left p-4 rounded-xl space-y-2 transition-all"
                >
                  <div className="flex items-center justify-between text-xs text-[#22D3EE]">
                    <span className="inline-flex items-center gap-1.5 font-semibold capitalize">
                      <FileText className="w-3.5 h-3.5" />
                      {chunk.source_kind} {chunk.source_start}
                    </span>
                    <span className="text-[#94A3B8] tabular-nums">~{chunk.token_estimate} tokens</span>
                  </div>
                  <p className="text-xs text-[#94A3B8] line-clamp-3 leading-relaxed">{chunk.preview}...</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Source Chunk Excerpt Modal */}
      {selectedChunk && (
        <div
          className="fixed inset-0 z-50 bg-[#0B1020]/80 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-[#151E33] border border-slate-400/20 rounded-2xl max-w-2xl w-full max-h-[80vh] flex flex-col shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-400/15 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <BookOpen className="w-4 h-4 text-[#22D3EE] shrink-0" />
                <span className="font-display text-sm font-semibold text-[#F8FAFC] truncate">
                  {selectedChunk.document_title} · {selectedChunk.chunk.source_kind}{' '}
                  {selectedChunk.chunk.source_start}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedChunk(null)}
                className="p-2 rounded-xl bg-[#11182B] border border-slate-400/15 text-[#94A3B8] hover:text-[#F8FAFC] transition-colors shrink-0"
                aria-label="Close excerpt"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto text-sm text-[#F8FAFC]/90 whitespace-pre-wrap leading-relaxed">
              {selectedChunk.chunk.content}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
