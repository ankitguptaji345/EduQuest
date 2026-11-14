import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BookOpen,
  Compass,
  FileText,
  Loader2,
  MessageSquare,
  Target,
  X,
} from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { useUIStore } from '../store/useUIStore';
import type { DocumentJob, LearningWorld, StudyDocument, Topic } from '../types/api';

interface DocumentAnalysis {
  summary: string;
  learning_objectives: string[];
  model: string;
}

interface ChunkPreview {
  id: string;
  chunk_index: number;
  source_kind: string;
  source_start: number;
  heading_path: string[];
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

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  const [selectedChunk, setSelectedChunk] = useState<{
    document_title: string;
    chunk: { id: string; source_kind: string; source_start: number; heading_path: string[]; content: string };
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
        chunk: { id: string; source_kind: string; source_start: number; heading_path: string[]; content: string };
      }>(`/api/documents/${id}/chunks/${chunkId}`);
      setSelectedChunk(res);
    } catch {
      addToast('error', 'Could not load source excerpt.');
    }
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
  const topTopics = topics.filter((t) => t.kind === 'topic');
  const childTopicsMap = new Map<string, Topic[]>();
  topics.forEach((t) => {
    if (t.parent_id) {
      const list = childTopicsMap.get(t.parent_id) || [];
      list.push(t);
      childTopicsMap.set(t.parent_id, list);
    }
  });

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
            <span>{doc.page_count} sections</span>
            <span>·</span>
            <span>{topics.length} extracted topics</span>
          </div>
        </div>

        {doc.status === 'ready' && (
          <div className="flex flex-wrap gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => startQuizMut.mutate()}
              disabled={startQuizMut.isPending}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors whitespace-nowrap"
            >
              {startQuizMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Target className="w-3.5 h-3.5" />}
              Launch Diagnostic Quiz
            </button>
            <button
              type="button"
              onClick={() => generateWorldMut.mutate()}
              disabled={generateWorldMut.isPending}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/20 text-xs font-semibold text-[#F8FAFC] transition-colors whitespace-nowrap"
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
          </div>
        )}
      </div>

      {doc.status === 'failed' && (
        <div className="p-4 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-sm text-[#EF4444]">
          {doc.error_code ? `[${doc.error_code}] ` : ''}
          {doc.error_message_safe || 'Document processing failed.'}
        </div>
      )}

      {analysis && (
        <div className="eq-card rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-[#F8FAFC]">
              Document Summary & Objectives
            </h2>
            <span className="text-xs font-medium text-[#22D3EE]">Rule-Based Engine</span>
          </div>
          <p className="text-sm text-[#F8FAFC]/90 leading-relaxed">{analysis.summary}</p>
          {analysis.learning_objectives.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-slate-400/15">
              <p className="text-xs font-semibold text-[#22D3EE] uppercase tracking-wide">
                Extracted Learning Objectives
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

      {/* Topics Hierarchy */}
      <div className="space-y-4">
        <h2 className="font-display text-lg font-semibold text-[#F8FAFC]">Extracted Knowledge Map</h2>
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
                <div
                  key={topic.id}
                  className="eq-card eq-card-hover rounded-2xl p-5 space-y-3.5"
                >
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

                  {topic.definition && (
                    <div className="p-3.5 rounded-xl bg-[#11182B] border border-slate-400/15 text-xs text-[#F8FAFC]/90 leading-relaxed">
                      <span className="font-semibold text-[#22D3EE]">Key Definition: </span>
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

                  {topic.examples.length > 0 && (
                    <div className="text-xs text-[#94A3B8] space-y-1.5">
                      <span className="font-semibold text-[#F8FAFC]">Examples:</span>
                      {topic.examples.map((ex, idx) => (
                        <p key={idx} className="pl-3 border-l border-slate-400/25 leading-relaxed">
                          {ex}
                        </p>
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

      {/* Indexed Source Chunks */}
      {chunks.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold text-[#F8FAFC]">
            Indexed Source Chunks ({chunks.length})
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {chunks.slice(0, 12).map((chunk) => (
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
