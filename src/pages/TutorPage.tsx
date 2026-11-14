import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { useUIStore } from '../store/useUIStore';
import type {
  StudyDocument,
  TutorCitation,
  TutorConversation,
  TutorMessage,
} from '../types/api';

const STYLES = [
  { id: 'step_by_step', label: 'Step by Step' },
  { id: 'beginner', label: 'Beginner Friendly' },
  { id: 'academic', label: 'Academic' },
  { id: 'example_based', label: 'Example Based' },
  { id: 'exam_oriented', label: 'Exam Oriented' },
];

const GROUNDING_LABELS: Record<TutorMessage['grounding'], { text: string; color: string }> = {
  document: { text: 'Grounded in Study Material', color: 'text-[#22C55E]' },
  mixed: { text: 'Partially Grounded', color: 'text-[#22D3EE]' },
  general: { text: 'General Guidance', color: 'text-[#F59E0B]' },
  not_in_document: { text: 'Not Found in Uploaded Material', color: 'text-[#EF4444]' },
};

export function TutorPage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState('Study Session');
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [style, setStyle] = useState('step_by_step');
  const [prompt, setPrompt] = useState('');
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [citationDrawer, setCitationDrawer] = useState<{
    citation: TutorCitation;
    fullContent: string;
    docTitle: string;
  } | null>(null);

  const { data: docsData } = useQuery({
    queryKey: ['documents'],
    queryFn: () => apiFetch<{ items: StudyDocument[] }>('/api/documents?status=ready'),
  });

  const { data: convsData } = useQuery({
    queryKey: ['tutor-conversations'],
    queryFn: () => apiFetch<{ items: TutorConversation[] }>('/api/tutor/conversations'),
  });

  const { data: convDetail, isLoading: loadingMsgs } = useQuery({
    queryKey: ['tutor-conversation', activeConvId],
    queryFn: () =>
      apiFetch<{ conversation: TutorConversation; messages: TutorMessage[] }>(
        `/api/tutor/conversations/${activeConvId}`,
      ),
    enabled: Boolean(activeConvId),
  });

  const convs = convsData?.items || [];
  const docs = docsData?.items || [];

  useEffect(() => {
    const preselectDoc = searchParams.get('doc');
    if (preselectDoc && docs.some((d) => d.id === preselectDoc) && selectedDocIds.length === 0) {
      setSelectedDocIds([preselectDoc]);
      setShowNewModal(true);
    }
  }, [searchParams, docs, selectedDocIds.length]);

  useEffect(() => {
    if (!activeConvId && convs.length > 0) {
      setActiveConvId(convs[0].id);
    }
  }, [activeConvId, convs]);

  const createConvMut = useMutation({
    mutationFn: () =>
      apiFetch<{ conversation: TutorConversation }>('/api/tutor/conversations', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle.trim() || 'Study Session',
          document_ids: selectedDocIds,
          explanation_style: style,
        }),
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['tutor-conversations'] });
      setActiveConvId(res.conversation.id);
      setShowNewModal(false);
      setFollowUps([]);
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Failed to start conversation.');
    },
  });

  const deleteConvMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/tutor/conversations/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: ['tutor-conversations'] });
      if (activeConvId === id) setActiveConvId(null);
    },
  });

  const sendMsgMut = useMutation({
    mutationFn: (text: string) =>
      apiFetch<{
        user_message: TutorMessage;
        assistant_message: TutorMessage;
        follow_ups: string[];
        provider_label: string;
      }>('/api/tutor/chat', {
        method: 'POST',
        body: JSON.stringify({
          conversation_id: activeConvId,
          message: text,
          explanation_style: style,
        }),
      }),
    onSuccess: (res) => {
      setPrompt('');
      setFollowUps(res.follow_ups || []);
      void queryClient.invalidateQueries({ queryKey: ['tutor-conversation', activeConvId] });
      void queryClient.invalidateQueries({ queryKey: ['tutor-conversations'] });
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Tutor could not respond.');
    },
  });

  const openCitation = async (c: TutorCitation) => {
    if (!c.chunk_id) {
      setCitationDrawer({
        citation: c,
        fullContent: c.excerpt,
        docTitle: 'Referenced Study Material',
      });
      return;
    }
    try {
      const res = await apiFetch<{
        document_title: string;
        chunk: { content: string };
      }>(`/api/documents/${c.document_id}/chunks/${c.chunk_id}`);
      setCitationDrawer({
        citation: c,
        fullContent: res.chunk.content,
        docTitle: res.document_title,
      });
    } catch {
      setCitationDrawer({
        citation: c,
        fullContent: c.excerpt,
        docTitle: 'Referenced Study Material',
      });
    }
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !activeConvId || sendMsgMut.isPending) return;
    sendMsgMut.mutate(prompt.trim());
  };

  const messages = convDetail?.messages || [];

  return (
    <div className="grid lg:grid-cols-12 gap-6 min-h-[72vh]">
      {/* Left Conversation Sidebar */}
      <div className="lg:col-span-4 xl:col-span-3 bg-[#151E33] border border-slate-400/15 rounded-2xl p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-base font-bold">AI Tutor</h1>
            <p className="text-xs text-[#94A3B8]">Rule-Based Engine</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (selectedDocIds.length === 0 && docs.length > 0) {
                setSelectedDocIds(docs.slice(0, 2).map((d) => d.id));
              }
              setShowNewModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </button>
        </div>

        <div className="flex-1 space-y-1.5 overflow-y-auto">
          {convs.length === 0 ? (
            <p className="text-xs text-[#94A3B8] py-4">
              Start a conversation linked to your study documents for cited answers.
            </p>
          ) : (
            convs.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                  activeConvId === c.id
                    ? 'bg-[#8B5CF6]/15 border-[#8B5CF6]/35 text-[#F8FAFC]'
                    : 'bg-[#11182B] border-slate-400/15 text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
                onClick={() => setActiveConvId(c.id)}
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{c.title}</p>
                  <p className="text-[11px] text-[#94A3B8] tabular-nums">
                    {c.message_count} messages · {c.document_ids.length} doc(s)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConvMut.mutate(c.id);
                  }}
                  className="opacity-70 hover:opacity-100 text-[#94A3B8] hover:text-[#EF4444]"
                  aria-label="Delete conversation"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Pane */}
      <div className="lg:col-span-8 xl:col-span-9 bg-[#151E33] border border-slate-400/15 rounded-2xl flex flex-col overflow-hidden">
        {!activeConvId ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
            <MessageSquare className="w-10 h-10 text-[#22D3EE]" />
            <div className="max-w-md space-y-1.5">
              <h2 className="font-display text-lg font-bold">Source-Grounded Study Tutor</h2>
              <p className="text-sm text-[#94A3B8]">
                Every response cites exact sections of your uploaded materials and refuses to invent
                facts when a topic is absent from your notes.
              </p>
            </div>
            {docs.length === 0 ? (
              <Link
                to="/upload"
                className="px-4 py-2 rounded-lg bg-[#8B5CF6] text-white text-xs font-semibold"
              >
                Upload Study Material First
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSelectedDocIds(docs.slice(0, 2).map((d) => d.id));
                  setShowNewModal(true);
                }}
                className="px-4 py-2 rounded-lg bg-[#8B5CF6] text-white text-xs font-semibold"
              >
                Start Grounded Chat
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-slate-400/15 flex flex-wrap items-center justify-between gap-3 bg-[#11182B]">
              <div>
                <h2 className="font-display text-sm font-semibold">
                  {convDetail?.conversation.title || 'Study Session'}
                </h2>
                <p className="text-xs text-[#94A3B8]">
                  Rule-Based Engine · {convDetail?.conversation.document_ids.length || 0} linked source(s)
                </p>
              </div>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                aria-label="Explanation style"
                className="bg-[#151E33] border border-slate-400/20 rounded-lg px-2.5 py-1.5 text-xs text-[#F8FAFC]"
              >
                {STYLES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {loadingMsgs ? (
                <div className="text-xs text-[#94A3B8]">Loading conversation...</div>
              ) : messages.length === 0 ? (
                <div className="text-sm text-[#94A3B8] py-8 text-center">
                  Ask any question about your linked study materials to receive a cited explanation.
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-2xl rounded-xl p-4 space-y-2.5 ${
                        m.role === 'user'
                          ? 'bg-[#8B5CF6]/20 border border-[#8B5CF6]/35 text-[#F8FAFC]'
                          : 'bg-[#11182B] border border-slate-400/15 text-[#F8FAFC]'
                      }`}
                    >
                      {m.role === 'assistant' && (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs pb-1.5 border-b border-slate-400/15">
                          <span className="text-[#94A3B8]">Rule-Based Engine</span>
                          <span className={GROUNDING_LABELS[m.grounding]?.color || 'text-[#94A3B8]'}>
                            {GROUNDING_LABELS[m.grounding]?.text || m.grounding}
                          </span>
                        </div>
                      )}
                      <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</div>

                      {m.role === 'assistant' && m.sources.length > 0 && (
                        <div className="pt-2 border-t border-slate-400/15 space-y-1.5">
                          <p className="text-[11px] font-medium text-[#94A3B8]">Citations:</p>
                          <div className="flex flex-wrap gap-1.5">
                            {m.sources.map((src, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => void openCitation(src)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#151E33] hover:bg-[#1B2740] border border-[#22D3EE]/30 text-xs text-[#22D3EE]"
                              >
                                <FileText className="w-3 h-3" />
                                {src.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}

              {sendMsgMut.isPending && (
                <div className="flex justify-start">
                  <div className="px-4 py-3 rounded-xl bg-[#11182B] border border-slate-400/15 text-xs text-[#94A3B8] inline-flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#22D3EE]" />
                    Searching uploaded documents...
                  </div>
                </div>
              )}
            </div>

            {/* Suggested Follow-Ups */}
            {followUps.length > 0 && (
              <div className="px-5 py-2 border-t border-slate-400/15 flex flex-wrap gap-2 bg-[#11182B]/60">
                {followUps.map((f, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => sendMsgMut.mutate(f)}
                    className="px-3 py-1 rounded-lg bg-[#151E33] hover:bg-[#1B2740] border border-slate-400/20 text-xs text-[#22D3EE]"
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}

            {/* Composer */}
            <form onSubmit={handleSend} className="p-4 border-t border-slate-400/15 flex gap-2.5 bg-[#11182B]">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ask a question grounded in your study materials..."
                className="flex-1 bg-[#151E33] border border-slate-400/20 rounded-lg px-4 py-2.5 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
              />
              <button
                type="submit"
                disabled={!prompt.trim() || sendMsgMut.isPending}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-sm font-semibold"
              >
                <Send className="w-4 h-4" />
                Ask
              </button>
            </form>
          </>
        )}
      </div>

      {/* New Conversation Modal */}
      {showNewModal && (
        <div
          className="fixed inset-0 z-50 bg-[#0B1020]/80 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-[#151E33] border border-slate-400/20 rounded-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">New Tutor Conversation</h2>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="text-[#94A3B8] hover:text-[#F8FAFC]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#94A3B8]">Session Title</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full bg-[#11182B] border border-slate-400/20 rounded-lg px-3.5 py-2 text-sm text-[#F8FAFC]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-[#94A3B8]">
                Select Grounding Documents ({selectedDocIds.length} selected)
              </label>
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {docs.length === 0 ? (
                  <p className="text-xs text-[#94A3B8]">No ready documents yet.</p>
                ) : (
                  docs.map((d) => {
                    const checked = selectedDocIds.includes(d.id);
                    return (
                      <label
                        key={d.id}
                        className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[#11182B] border border-slate-400/15 cursor-pointer text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedDocIds((prev) =>
                              checked ? prev.filter((x) => x !== d.id) : [...prev, d.id],
                            )
                          }
                          className="accent-[#8B5CF6]"
                        />
                        <span className="truncate font-medium text-[#F8FAFC]">{d.title}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 rounded-lg bg-[#11182B] border border-slate-400/20 text-xs text-[#94A3B8]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => createConvMut.mutate()}
                disabled={createConvMut.isPending}
                className="px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold"
              >
                {createConvMut.isPending ? 'Starting...' : 'Create Chat'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Citation Drawer */}
      {citationDrawer && (
        <div
          className="fixed inset-0 z-50 bg-[#0B1020]/70 backdrop-blur-sm flex justify-end"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-[#151E33] border-l border-slate-400/20 w-full max-w-md h-full flex flex-col">
            <div className="px-5 py-4 border-b border-slate-400/15 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[#22D3EE]" />
                <span className="font-display text-sm font-semibold truncate">
                  {citationDrawer.docTitle} · {citationDrawer.citation.label}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCitationDrawer(null)}
                className="text-[#94A3B8] hover:text-[#F8FAFC]"
                aria-label="Close citation drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              <div className="p-3.5 rounded-xl bg-[#11182B] border border-[#22D3EE]/30 text-xs text-[#22D3EE]">
                Matched Excerpt: “{citationDrawer.citation.excerpt}”
              </div>
              <div className="text-sm text-[#F8FAFC]/90 whitespace-pre-wrap leading-relaxed">
                {citationDrawer.fullContent}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
