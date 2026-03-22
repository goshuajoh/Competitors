import { X, ExternalLink, FileText } from 'lucide-react';
import { flatten } from '../lib/compare';

const SECTIONS = [
  { key: 'connectivity', label: 'Connectivity' },
  { key: 'processing', label: 'Processing' },
  { key: 'memory', label: 'Memory' },
  { key: 'peripherals', label: 'Peripherals' },
  { key: 'security', label: 'Security' },
  { key: 'power_management', label: 'Power Management' },
  { key: 'package', label: 'Package' },
  { key: 'software_ecosystem', label: 'Software Ecosystem' },
  { key: 'pricing', label: 'Pricing' },
];

export default function ChipDetail({ chip, onClose }) {
  if (!chip) return null;

  const meta = chip.metadata || {};

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/50" onClick={onClose}>
      <div
        className="w-full md:max-w-2xl h-full bg-gray-900 md:border-l border-gray-700 overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-800 p-4 flex items-center justify-between z-10">
          <div>
            <h3 className="text-lg font-bold text-white">{chip.chip_model}</h3>
            <p className="text-sm text-gray-400">{chip._manufacturer} &middot; {chip.chip_family}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* Quick info */}
          <div className="flex flex-wrap gap-2 items-center">
            <Badge label={chip.status} />
            {chip.release_year && <Badge label={`${chip.release_year}`} />}
            {meta.confidence && <Badge label={`confidence: ${meta.confidence}`} />}
            {chip._datasheet_url && (
              <a
                href={chip._datasheet_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 px-3 py-1 rounded-full transition-colors"
              >
                <FileText size={12} />
                Datasheet
              </a>
            )}
          </div>

          {chip.target_applications?.length > 0 && (
            <div>
              <Label>Target Applications</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {chip.target_applications.map((app) => (
                  <span key={app} className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded">{app}</span>
                ))}
              </div>
            </div>
          )}

          {/* Sections */}
          {SECTIONS.map(({ key, label }) => {
            const sectionData = chip[key];
            if (!sectionData || typeof sectionData !== 'object') return null;
            const rows = flatten(sectionData);
            if (rows.length === 0) return null;

            return (
              <div key={key}>
                <Label>{label}</Label>
                <div className="mt-1 bg-gray-800/50 rounded-lg overflow-hidden">
                  {rows.map(({ key: k, value }, i) => (
                    <div
                      key={k}
                      className={`flex items-center text-sm py-1.5 px-3 ${i % 2 === 0 ? '' : 'bg-gray-800/30'}`}
                    >
                      <span className="text-gray-400 w-1/2 truncate">{formatKey(k)}</span>
                      <span className={`w-1/2 ${getValueColor(value)}`}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Metadata */}
          {meta.notes && (
            <div>
              <Label>Notes</Label>
              <p className="text-sm text-gray-400 mt-1 leading-relaxed">{meta.notes}</p>
            </div>
          )}

          {meta.source_urls?.length > 0 && (
            <div>
              <Label>Sources</Label>
              <div className="mt-1 space-y-1">
                {meta.source_urls.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 truncate"
                  >
                    <ExternalLink size={12} />
                    {url}
                  </a>
                ))}
              </div>
            </div>
          )}

          {meta.last_updated && (
            <p className="text-xs text-gray-600">Last updated: {meta.last_updated}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Label({ children }) {
  return <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{children}</h4>;
}

function Badge({ label }) {
  return <span className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full">{label}</span>;
}

function formatKey(key) {
  return key
    .replace(/\./g, ' > ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getValueColor(value) {
  if (value === 'Yes') return 'text-green-400';
  if (value === 'No') return 'text-red-400/60';
  if (value === '—') return 'text-gray-600';
  return 'text-gray-200';
}
