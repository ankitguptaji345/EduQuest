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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Study Library</h1>
          <p className="text-sm text-[#94A3B8] mt-1">
            Manage your uploaded study materials, inspect extracted topics, or reprocess files.
          </p>
        </div>
        <Link
          to="/upload"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold whitespace-nowrap self-start sm:self-auto"
        >
          <Upload className="w-4 h-4" />
          Upload Material
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 bg-[#151E33] border border-slate-400/15 rounded-xl p-4">
        <div className="flex items-center gap-2">
          <label htmlFor="subject-filter" className="text-xs text-[#94A3B8]">
            Subject
          </label>
          <select
            id="subject-filter"
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="bg-[#11182B] border border-slate-400/20 rounded-lg px-3 py-1.5 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
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
          <label htmlFor="status-filter" className="text-xs text-[#94A3B8]">
            Status
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#11182B] border border-slate-400/20 rounded-lg px-3 py-1.5 text-xs text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
          >
            <option value="">All Statuses</option>
            <option value="ready">Ready</option>
            <option value="processing">Processing</option>
            <option value="uploaded">Queued</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-24 rounded-xl bg-[#151E33]" />
          ))}
        </div>
      ) : docs.length === 0 ? (
        <div className="bg-[#151E33] border border-slate-400/15 rounded-2xl p-10 text-center space-y-4">
          <BookOpen className="w-10 h-10 text-[#22D3EE] mx-auto" />
          <div className="space-y-1">
            <h2 className="font-display text-lg font-semibold">No study materials found</h2>
            <p className="text-sm text-[#94A3B8]">
              {subjectFilter || statusFilter
                ? 'Try clearing your filters or upload a new study document.'
                : 'Upload PDF, DOCX, PPTX, or TXT notes to begin extracting topics.'}
            </p>
          </div>
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Study Material
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {docs.map((doc) => {
            const subj = doc.subject_id ? subjectMap.get(doc.subject_id) : null;
            const statusColor =
              doc.status === 'ready'
                ? 'text-[#22C55E]'
                : doc.status === 'failed'
                  ? 'text-[#EF4444]'
                  : 'text-[#F59E0B]';

            return (
              <div
                key={doc.id}
                className="bg-[#151E33] border border-slate-400/15 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText className="w-4 h-4 text-[#22D3EE] shrink-0" />
                    <Link
                      to={`/documents/${doc.id}`}
                      className="font-display text-base font-semibold text-[#F8FAFC] hover:text-[#22D3EE] transition-colors truncate"
                    >
                      {doc.title}
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#94A3B8]">
                    <span className={`font-medium uppercase ${statusColor}`}>{doc.status}</span>
                    <span>·</span>
                    <span className="uppercase">{doc.file_ext}</span>
                    <span>·</span>
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
                        <span className="text-[#F8FAFC]">{subj.name}</span>
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

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Link
                    to={`/documents/${doc.id}`}
                    className="px-3 py-1.5 rounded-lg bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/15 text-xs font-medium text-[#F8FAFC]"
                  >
                    Inspect
                  </Link>
                  <button
                    type="button"
                    onClick={() => reprocessMut.mutate(doc.id)}
                    disabled={reprocessMut.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/15 text-xs text-[#94A3B8] hover:text-[#F8FAFC]"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Reprocess
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownload(doc)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/15 text-xs text-[#94A3B8] hover:text-[#F8FAFC]"
                    aria-label={`Download ${doc.title}`}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(doc)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#11182B] hover:bg-[#EF4444]/15 border border-slate-400/15 text-xs text-[#EF4444]"
                    aria-label={`Delete ${doc.title}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
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
          <div className="bg-[#151E33] border border-slate-400/20 rounded-2xl max-w-md w-full p-6 space-y-4">
            <h2 className="font-display text-lg font-bold text-[#F8FAFC]">Delete Study Material?</h2>
            <p className="text-sm text-[#94A3B8]">
              Are you sure you want to delete <strong className="text-[#F8FAFC]">{deleteTarget.title}</strong>?
              The stored file, chunks, and document topics will be removed, while your earned XP, quiz
              history, topic mastery snapshots, and misconception threads are safely preserved.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg bg-[#11182B] border border-slate-400/20 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteMut.mutate(deleteTarget.id)}
                disabled={deleteMut.isPending}
                className="px-4 py-2 rounded-lg bg-[#EF4444] hover:bg-[#DC2626] text-white text-xs font-semibold"
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
