import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  BookOpen,
  Download,
  FileText,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { useAuthStore } from '../store/useAuthStore';
import { useUIStore } from '../store/useUIStore';
import type { StudyDocument, Subject } from '../types/api';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function DocumentsPage() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const token = useAuthStore((s) => s.token);
  const [subjectFilter, setSubjectFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [deleteTarget, setDeleteTarget] = useState<StudyDocument | null>(null);

  const { data: subjectsData } = useQuery({
    queryKey: ['subjects'],
    queryFn: () => apiFetch<{ items: Subject[] }>('/api/subjects'),
  });

  const { data: docsData, isLoading } = useQuery({
    queryKey: ['documents', subjectFilter, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (subjectFilter) params.set('subject_id', subjectFilter);
      if (statusFilter) params.set('status', statusFilter);
      const qs = params.toString();
      return apiFetch<{ items: StudyDocument[] }>(`/api/documents${qs ? `?${qs}` : ''}`);
    },
    refetchInterval: (query) => {
      const items = query.state.data?.items || [];
      return items.some((d) => d.status === 'uploaded' || d.status === 'processing') ? 2500 : false;
    },
  });

  const reprocessMut = useMutation({
    mutationFn: (docId: string) =>
      apiFetch(`/api/documents/${docId}/reprocess`, { method: 'POST' }),
    onSuccess: () => {
      addToast('info', 'Reprocessing queued in background.');
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Failed to queue reprocessing.');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (docId: string) => apiFetch(`/api/documents/${docId}`, { method: 'DELETE' }),
    onSuccess: () => {
      addToast('success', 'Study material deleted. Mastery, XP, and misconceptions preserved.');
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics-overview'] });
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Failed to delete document.');
    },
  });

  const handleDownload = async (doc: StudyDocument) => {
    try {
      const res = await fetch(`/api/documents/${doc.id}/file`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.original_filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      addToast('error', 'Unable to download study file.');
    }
  };

  const subjects = subjectsData?.items || [];
  const subjectMap = new Map(subjects.map((s) => [s.id, s]));
  const docs = docsData?.items || [];

  return (
    <div className="space-y-6">
      <div className="eq-hero-surface rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-[#22D3EE]">Grounded Knowledge Base</p>
          <h1 className="font-display text-2xl font-bold text-[#F8FAFC]">Study Library</h1>
          <p className="text-sm text-[#94A3B8]">
            Manage your uploaded study materials, inspect extracted topics, or reprocess files.
          </p>
        </div>
        <Link
          to="/upload"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Upload className="w-4 h-4" />
          Upload Material
        </Link>
      </div>

      {/* Filters */}
      <div className="eq-card flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label htmlFor="subject-filter" className="text-xs font-medium text-[#94A3B8]">
              Subject
            </label>
            <select
              id="subject-filter"
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              className="bg-[#11182B] border border-slate-400/20 rounded-xl px-3.5 py-2 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
            >
              <option value="">All Subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="status-filter" className="text-xs font-medium text-[#94A3B8]">
              Status
            </label>
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-[#11182B] border border-slate-400/20 rounded-xl px-3.5 py-2 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
            >
              <option value="">All Statuses</option>
              <option value="ready">Ready</option>
              <option value="processing">Processing</option>
              <option value="uploaded">Queued</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        <span className="text-xs text-[#94A3B8] tabular-nums">
          {docs.length} {docs.length === 1 ? 'document' : 'documents'}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-24 rounded-2xl bg-[#151E33] border border-slate-400/10" />
          ))}
        </div>
      ) : docs.length === 0 ? (
        <div className="eq-card rounded-2xl p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#22D3EE]/10 border border-[#22D3EE]/25 flex items-center justify-center mx-auto">
            <BookOpen className="w-6 h-6 text-[#22D3EE]" />
          </div>
          <div className="space-y-1.5">
            <h2 className="font-display text-lg font-semibold text-[#F8FAFC]">No study materials found</h2>
            <p className="text-sm text-[#94A3B8] max-w-md mx-auto">
              {subjectFilter || statusFilter
                ? 'Try clearing your filters or upload a new study document.'
                : 'Upload PDF, DOCX, PPTX, or TXT notes to begin extracting topics.'}
            </p>
          </div>
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Study Material
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {docs.map((doc) => {
            const subj = doc.subject_id ? subjectMap.get(doc.subject_id) : null;
            const statusClasses =
              doc.status === 'ready'
                ? 'bg-[#22C55E]/10 border-[#22C55E]/30 text-[#22C55E]'
                : doc.status === 'failed'
                  ? 'bg-[#EF4444]/10 border-[#EF4444]/30 text-[#EF4444]'
                  : 'bg-[#F59E0B]/10 border-[#F59E0B]/30 text-[#F59E0B]';

            return (
              <div
                key={doc.id}
                className="eq-card eq-card-hover rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#22D3EE]/10 border border-[#22D3EE]/25 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-[#22D3EE]" />
                  </div>
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Link
                        to={`/documents/${doc.id}`}
                        className="font-display text-base font-semibold text-[#F8FAFC] hover:text-[#22D3EE] transition-colors truncate"
                      >
                        {doc.title}
                      </Link>
                      <span
                        className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold uppercase tracking-wide ${statusClasses}`}
                      >
                        {doc.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#94A3B8]">
                      <span className="px-1.5 py-0.5 rounded bg-[#11182B] border border-slate-400/15 font-mono uppercase text-[11px] text-[#F8FAFC]">
                        {doc.file_ext}
                      </span>
                      <span className="tabular-nums">{formatBytes(doc.size_bytes)}</span>
                      {doc.page_count > 0 && (
                        <>
                          <span>·</span>
                          <span className="tabular-nums">{doc.page_count} sections/pages</span>
                        </>
                      )}
                      {subj && (
                        <>
                          <span>·</span>
                          <span className="text-[#F8FAFC] font-medium">{subj.name}</span>
                        </>
                      )}
                      {doc.latest_job && (doc.status === 'processing' || doc.status === 'uploaded') && (
                        <>
                          <span>·</span>
                          <span className="text-[#22D3EE]">Stage: {doc.latest_job.stage}</span>
                        </>
                      )}
                    </div>
                    {doc.status === 'failed' && doc.error_message_safe && (
                      <p className="text-xs text-[#EF4444] flex items-center gap-1.5 pt-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {doc.error_code ? `[${doc.error_code}] ` : ''}
                          {doc.error_message_safe}
                        </span>
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Link
                    to={`/documents/${doc.id}`}
                    className="px-3.5 py-2 rounded-xl bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/20 text-xs font-semibold text-[#F8FAFC] transition-colors whitespace-nowrap"
                  >
                    Inspect
                  </Link>
                  <button
                    type="button"
                    onClick={() => reprocessMut.mutate(doc.id)}
                    disabled={reprocessMut.isPending}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/20 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] transition-colors whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Reprocess
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownload(doc)}
                    className="inline-flex items-center justify-center p-2 rounded-xl bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/20 text-xs text-[#94A3B8] hover:text-[#F8FAFC] transition-colors"
                    aria-label={`Download ${doc.title}`}
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(doc)}
                    className="inline-flex items-center justify-center p-2 rounded-xl bg-[#11182B] hover:bg-[#EF4444]/15 border border-slate-400/20 text-xs text-[#EF4444] transition-colors"
                    aria-label={`Delete ${doc.title}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-[#0B1020]/80 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-[#151E33] border border-slate-400/20 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h2 className="font-display text-lg font-bold text-[#F8FAFC]">Delete Study Material?</h2>
            <p className="text-sm text-[#94A3B8] leading-relaxed">
              Are you sure you want to delete <strong className="text-[#F8FAFC]">{deleteTarget.title}</strong>?
              The stored file, chunks, and document topics will be removed, while your earned XP, quiz
              history, topic mastery snapshots, and misconception threads are safely preserved.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/20 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteMut.mutate(deleteTarget.id)}
                disabled={deleteMut.isPending}
                className="px-4 py-2 rounded-xl bg-[#EF4444] hover:bg-[#DC2626] text-white text-xs font-semibold transition-colors"
              >
                {deleteMut.isPending ? 'Deleting...' : 'Delete File'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
