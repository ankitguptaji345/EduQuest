import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Bot,
  ChevronRight,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { useAuthStore } from '../store/useAuthStore';
import { useUIStore } from '../store/useUIStore';
import type {
  StudyDocument,
  Topic,
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

function renderFormattedLine(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-[#F8FAFC]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function FormattedMessage({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-[#F8FAFC]/90">
      {lines.map((raw, idx) => {
        const line = raw.trim();
        if (!line) return <div key={idx} className="h-1" />;
        if (line.startsWith('- ')) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span className="text-[#22D3EE] mt-0.5">•</span>
              <span>{renderFormattedLine(line.slice(2))}</span>
            </div>
          );
        }
        return <p key={idx}>{renderFormattedLine(line)}</p>;
      })}
    </div>
  );
}

export function TutorPage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const addToast = useUIStore((s) => s.addToast);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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

  const { data: topicsData } = useQuery({
    queryKey: ['topics-for-tutor'],
    queryFn: () => apiFetch<{ items: Topic[] }>('/api/topics'),
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
  const topics = topicsData?.items || [];

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [convDetail?.messages?.length]);

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
  const activeConvDocIds = convDetail?.conversation.document_ids || [];
  const starterTopics = topics
    .filter((t) => activeConvDocIds.length === 0 || activeConvDocIds.includes(t.document_id))
    .slice(0, 3);

  return (
    <div className="grid lg:grid-cols-12 gap-5 lg:h-[calc(100vh-8.5rem)] min-h-[540px]">
      {/* Left Conversation Sidebar */}
      <div className="lg:col-span-4 xl:col-span-3 eq-card rounded-2xl p-4 flex flex-col gap-4 overflow-hidden">
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-400/15">
          <div className="min-w-0">
            <h1 className="font-display text-base font-bold truncate">AI Study Tutor</h1>
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold shrink-0 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </button>
        </div>

        <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
          {convs.length === 0 ? (
            <div className="p-4 rounded-xl bg-[#11182B] border border-slate-400/15 text-xs text-[#94A3B8] space-y-2">
              <p>No tutor sessions yet.</p>
              <p>Create a conversation linked to your study documents to receive cited explanations.</p>
            </div>
          ) : (
            convs.map((c) => {
              const active = activeConvId === c.id;
              return (
                <div
                  key={c.id}
                  onClick={() => setActiveConvId(c.id)}
                  className={`group flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                    active
                      ? 'bg-[#8B5CF6]/15 border-[#8B5CF6]/40 text-[#F8FAFC]'
                      : 'bg-[#11182B] border-slate-400/10 text-[#94A3B8] hover:text-[#F8FAFC] hover:border-slate-400/25'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{c.title}</p>
                    <p className="text-[11px] text-[#94A3B8] tabular-nums mt-0.5">
                      {c.message_count} messages · {c.document_ids.length} source(s)
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConvMut.mutate(c.id);
                    }}
                    className="opacity-60 hover:opacity-100 text-[#94A3B8] hover:text-[#EF4444] p-1 shrink-0"
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Main Chat Pane */}
      <div className="lg:col-span-8 xl:col-span-9 eq-card rounded-2xl flex flex-col overflow-hidden min-h-[500px]">
        {!activeConvId ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-[#22D3EE]/10 border border-[#22D3EE]/25 flex items-center justify-center">
              <MessageSquare className="w-7 h-7 text-[#22D3EE]" />
            </div>
            <div className="max-w-md space-y-2">
              <h2 className="font-display text-xl font-bold">Source-Grounded AI Tutor</h2>
              <p className="text-sm text-[#94A3B8] leading-relaxed">
                Every answer cites exact excerpts from your uploaded study files and refuses to invent
                facts when a topic is missing from your notes.
              </p>
            </div>
            {docs.length === 0 ? (
              <Link
                to="/upload"
                className="px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors"
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
                className="px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors"
              >
                Start Grounded Chat
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Workspace Header */}
            <div className="px-5 py-3.5 border-b border-slate-400/15 flex flex-wrap items-center justify-between gap-3 bg-[#11182B]">
              <div className="min-w-0">
                <h2 className="font-display text-sm font-semibold truncate">
                  {convDetail?.conversation.title || 'Study Session'}
                </h2>
                <p className="text-xs text-[#94A3B8]">
                  Rule-Based Engine · {convDetail?.conversation.document_ids.length || 0} linked document(s)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="tutor-style" className="text-xs text-[#94A3B8] hidden sm:inline">
                  Style:
                </label>
                <select
                  id="tutor-style"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  aria-label="Explanation style"
                  className="bg-[#151E33] border border-slate-400/20 rounded-lg px-3 py-1.5 text-xs text-[#F8FAFC]"
                >
                  {STYLES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Messages Stream */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {loadingMsgs ? (
                <div className="space-y-4 animate-pulse">
                  <div className="h-16 w-2/3 rounded-xl bg-[#11182B]" />
                  <div className="h-24 w-3/4 rounded-xl bg-[#11182B] ml-auto" />
                </div>
              ) : messages.length === 0 ? (
                <div className="py-10 max-w-xl mx-auto text-center space-y-4">
                  <div className="w-11 h-11 rounded-xl bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 flex items-center justify-center mx-auto">
                    <Sparkles className="w-5 h-5 text-[#22D3EE]" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-display text-base font-semibold">Ask about your linked study materials</p>
                    <p className="text-xs text-[#94A3B8]">
                      Answers include clickable citations pointing to the exact source chunk.
                    </p>
                  </div>
                  {starterTopics.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-2 pt-2">
                      {starterTopics.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => sendMsgMut.mutate(`Explain ${t.name}`)}
                          className="px-3.5 py-2 rounded-xl bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/20 text-xs text-[#22D3EE] transition-colors"
                        >
                          Explain {t.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                messages.map((m) => {
                  const isUser = m.role === 'user';
                  return (
                    <div
                      key={m.id}
                      className={`flex items-start gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      {!isUser && (
                        <div className="w-8 h-8 rounded-xl bg-[#22D3EE]/15 border border-[#22D3EE]/30 flex items-center justify-center shrink-0 mt-0.5">
                          <Bot className="w-4 h-4 text-[#22D3EE]" />
                        </div>
                      )}

                      <div
                        className={`max-w-2xl rounded-2xl p-4 space-y-3 ${
                          isUser
                            ? 'bg-gradient-to-br from-[#8B5CF6]/25 to-[#8B5CF6]/15 border border-[#8B5CF6]/40 text-[#F8FAFC]'
                            : 'bg-[#11182B] border border-slate-400/15 text-[#F8FAFC]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs pb-2 border-b border-slate-400/15">
                          <span className="font-semibold text-[#F8FAFC]">
                            {isUser ? user?.full_name || 'You' : 'EduQuest Tutor · Rule-Based Engine'}
                          </span>
                          {!isUser && (
                            <span className={GROUNDING_LABELS[m.grounding]?.color || 'text-[#94A3B8]'}>
                              {GROUNDING_LABELS[m.grounding]?.text || m.grounding}
                            </span>
                          )}
                        </div>

                        <FormattedMessage content={m.content} />

                        {!isUser && m.sources.length > 0 && (
                          <div className="pt-2.5 border-t border-slate-400/15 space-y-2">
                            <p className="text-[11px] font-medium text-[#94A3B8]">
                              Source Citations (click to inspect excerpt):
                            </p>
                            <div className="grid sm:grid-cols-2 gap-2">
                              {m.sources.map((src, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => void openCitation(src)}
                                  className="text-left p-2.5 rounded-xl bg-[#151E33] hover:bg-[#1B2740] border border-[#22D3EE]/25 hover:border-[#22D3EE]/50 transition-colors group space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-1 text-xs font-semibold text-[#22D3EE]">
                                    <span className="inline-flex items-center gap-1.5 truncate">
                                      <FileText className="w-3.5 h-3.5 shrink-0" />
                                      {src.label}
                                    </span>
                                    <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-70 group-hover:translate-x-0.5 transition-transform" />
                                  </div>
                                  <p className="text-[11px] text-[#94A3B8] line-clamp-2">{src.excerpt}</p>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {isUser && (
                        <div className="w-8 h-8 rounded-xl bg-[#8B5CF6]/20 border border-[#8B5CF6]/35 flex items-center justify-center shrink-0 mt-0.5">
                          <User className="w-4 h-4 text-[#8B5CF6]" />
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {sendMsgMut.isPending && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-[#22D3EE]/15 border border-[#22D3EE]/30 flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-[#22D3EE]" />
                  </div>
                  <div className="px-4 py-3 rounded-2xl bg-[#11182B] border border-slate-400/15 text-xs text-[#94A3B8] inline-flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#22D3EE]" />
                    Searching uploaded documents & building cited reply...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Suggested Follow-Ups */}
            {followUps.length > 0 && (
              <div className="px-5 py-2.5 border-t border-slate-400/15 flex flex-wrap items-center gap-2 bg-[#11182B]/70">
                <span className="text-[11px] text-[#94A3B8]">Suggested:</span>
                {followUps.map((f, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => sendMsgMut.mutate(f)}
                    className="px-3 py-1.5 rounded-lg bg-[#151E33] hover:bg-[#1B2740] border border-slate-400/20 hover:border-[#22D3EE]/40 text-xs text-[#22D3EE] transition-colors"
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}

            {/* Input Area */}
            <form onSubmit={handleSend} className="p-4 border-t border-slate-400/15 flex gap-2.5 bg-[#11182B]">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ask a question grounded in your study materials..."
                className="flex-1 bg-[#151E33] border border-slate-400/20 rounded-xl px-4 py-2.5 text-sm text-[#F8FAFC] placeholder:text-[#94A3B8]/60 focus:outline-none focus:border-[#22D3EE]"
              />
              <button
                type="submit"
                disabled={!prompt.trim() || sendMsgMut.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-sm font-semibold transition-colors shrink-0"
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
          <div className="bg-[#151E33] border border-slate-400/20 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
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
                className="w-full bg-[#11182B] border border-slate-400/20 rounded-xl px-3.5 py-2.5 text-sm text-[#F8FAFC]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-[#94A3B8]">
                Select Grounding Documents ({selectedDocIds.length} selected)
              </label>
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {docs.length === 0 ? (
                  <p className="text-xs text-[#94A3B8]">No ready documents yet.</p>
                ) : (
                  docs.map((d) => {
                    const checked = selectedDocIds.includes(d.id);
                    return (
                      <label
                        key={d.id}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer text-xs transition-colors ${
                          checked
                            ? 'bg-[#8B5CF6]/15 border-[#8B5CF6]/40'
                            : 'bg-[#11182B] border-slate-400/15'
                        }`}
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
                className="px-4 py-2 rounded-xl bg-[#11182B] border border-slate-400/20 text-xs text-[#94A3B8]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => createConvMut.mutate()}
                disabled={createConvMut.isPending}
                className="px-4 py-2 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold"
              >
                {createConvMut.isPending ? 'Starting...' : 'Create Chat'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Citation Source Drawer */}
      {citationDrawer && (
        <div
          className="fixed inset-0 z-50 bg-[#0B1020]/75 backdrop-blur-sm flex justify-end"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-[#151E33] border-l border-slate-400/20 w-full max-w-lg h-full flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-400/15 flex items-center justify-between bg-[#11182B]">
              <div className="flex items-center gap-2 min-w-0">
                <BookOpen className="w-4 h-4 text-[#22D3EE] shrink-0" />
                <span className="font-display text-sm font-semibold truncate">
                  {citationDrawer.docTitle} · {citationDrawer.citation.label}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCitationDrawer(null)}
                className="text-[#94A3B8] hover:text-[#F8FAFC] p-1"
                aria-label="Close citation drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-5">
              <div className="p-4 rounded-xl bg-[#11182B] border border-[#22D3EE]/30 space-y-1">
                <p className="text-[11px] font-semibold text-[#22D3EE]">Cited Excerpt</p>
                <p className="text-xs text-[#F8FAFC]/90 leading-relaxed">
                  “{citationDrawer.citation.excerpt}”
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-[#94A3B8]">Full Indexed Section</p>
                <div className="text-sm text-[#F8FAFC]/90 whitespace-pre-wrap leading-relaxed bg-[#11182B] border border-slate-400/15 rounded-xl p-4">
                  {citationDrawer.fullContent}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
