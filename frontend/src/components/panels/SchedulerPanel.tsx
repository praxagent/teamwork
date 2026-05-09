/**
 * SchedulerPanel — manage cron schedules and one-time reminders.
 */
import { useState, useEffect } from 'react';
import { Clock, Plus, Trash2, Pause, Play, Pencil, Bell, Timer, X, Check } from 'lucide-react';
import { useSchedules, useCreateSchedule, useUpdateSchedule, useDeleteSchedule, useCreateReminder, useUpdateReminder, useDeleteReminder, useUserTimezone } from '@/hooks/useApi';
import type { Schedule, Reminder } from '@/hooks/useApi';
import { useUIStore } from '@/stores';
import { TimezonePicker } from '@/components/common/TimezonePicker';

const CHANNELS = [
  { value: 'all', label: 'All channels' },
  { value: 'sms', label: 'SMS' },
  { value: 'discord', label: 'Discord' },
  { value: 'teamwork', label: 'TeamWork' },
];

// ─── Cron builder ───────────────────────────────────────────────────
const FREQ = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'every-2h', label: 'Every 2 hours' },
  { value: 'every-3h', label: 'Every 3 hours' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekends', label: 'Weekends' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'custom', label: 'Custom cron' },
];

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${i === 0 ? 12 : i > 12 ? i - 12 : i}:00 ${i < 12 ? 'AM' : 'PM'}`,
}));

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function buildCron(freq: string, h: string, m: string, dow: string): string {
  switch (freq) {
    case 'hourly': return `${m} * * * *`;
    case 'every-2h': return `${m} */2 * * *`;
    case 'every-3h': return `${m} */3 * * *`;
    case 'daily': return `${m} ${h} * * *`;
    case 'weekdays': return `${m} ${h} * * 1-5`;
    case 'weekends': return `${m} ${h} * * 0,6`;
    case 'weekly': return `${m} ${h} * * ${dow}`;
    default: return '';
  }
}

function describeCron(cron: string): string {
  const p = cron.split(' ');
  if (p.length !== 5) return cron;
  const [min, hour, , , dow] = p;
  if (hour === '*') return `Hourly at :${min.padStart(2, '0')}`;
  if (hour.startsWith('*/')) return `Every ${hour.slice(2)}h at :${min.padStart(2, '0')}`;
  const h = Number(hour);
  const t = `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${min.padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  if (dow === '*') return `Daily at ${t}`;
  if (dow === '1-5') return `Weekdays at ${t}`;
  if (dow === '0,6') return `Weekends at ${t}`;
  const d: Record<string, string> = { '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat' };
  return d[dow] ? `${d[dow]} at ${t}` : cron;
}

function currentTimeStr(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function todayStr(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

// ─── Component ──────────────────────────────────────────────────────
interface Props { projectId: string; isVisible: boolean; onClose: () => void; }

export function SchedulerPanel({ isVisible }: Props) {
  const dark = useUIStore((s) => s.darkMode);
  const { data, isLoading } = useSchedules();
  const { data: tzData } = useUserTimezone();
  const userTz = tzData?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const deleteSchedule = useDeleteSchedule();
  const createReminder = useCreateReminder();
  const updateReminder = useUpdateReminder();
  const deleteReminder = useDeleteReminder();

  const [mode, setMode] = useState<'none' | 'cron' | 'reminder'>('none');
  const [editId, setEditId] = useState<string | null>(null);
  const [editKind, setEditKind] = useState<'schedule' | 'reminder'>('schedule');

  // Cron form
  const [cName, setCName] = useState('');
  const [cPrompt, setCPrompt] = useState('');
  const [cFreq, setCFreq] = useState('daily');
  const [cHour, setCHour] = useState(String(new Date().getHours()));
  const [cMin, setCMin] = useState('0');
  const [cDow, setCDow] = useState('1');
  const [cCustom, setCCustom] = useState('');
  const [cTz, setCTz] = useState('');
  const [cChan, setCChan] = useState('all');

  // Reminder form
  const [rName, setRName] = useState('');
  const [rPrompt, setRPrompt] = useState('');
  const [rDate, setRDate] = useState(todayStr());
  const [rTime, setRTime] = useState(currentTimeStr());
  const [rTz, setRTz] = useState('');
  const [rChan, setRChan] = useState('all');

  // Edit form
  const [eName, setEName] = useState('');
  const [ePrompt, setEPrompt] = useState('');
  const [eCron, setECron] = useState('');
  const [eDate, setEDate] = useState('');
  const [eTime, setETime] = useState('');

  // Set TZ defaults when loaded
  useEffect(() => {
    if (userTz && userTz !== 'UTC') {
      setCTz(prev => prev || userTz);
      setRTz(prev => prev || userTz);
    }
  }, [userTz]);

  const schedules = data?.schedules ?? [];
  const reminders = data?.reminders ?? [];
  if (!isVisible) return null;

  // Styles
  const bg = dark ? 'bg-slate-900' : 'bg-white';
  const card = dark ? 'bg-slate-800/60 border-slate-700' : 'bg-gray-50 border-gray-200';
  const t1 = dark ? 'text-slate-100' : 'text-slate-900';
  const t2 = dark ? 'text-slate-400' : 'text-slate-500';
  const t3 = dark ? 'text-slate-500' : 'text-slate-400';
  const inputBase = `px-2.5 py-1.5 rounded border text-sm outline-none ${dark ? 'bg-slate-700 text-slate-100 border-slate-600 focus:border-indigo-500' : 'bg-white text-slate-900 border-gray-300 focus:border-indigo-500'}`;
  const inp = `w-full ${inputBase}`;
  const sel = `${inputBase} cursor-pointer`;
  const btn = (color: string) => `px-3 py-1.5 rounded text-xs font-medium text-white ${color} disabled:opacity-40`;

  const cronVal = cFreq === 'custom' ? cCustom : buildCron(cFreq, cHour, cMin, cDow);
  const showHour = ['daily', 'weekdays', 'weekends', 'weekly'].includes(cFreq);
  const showMinOnly = ['hourly', 'every-2h', 'every-3h'].includes(cFreq);

  const resetCronForm = () => { setCName(''); setCPrompt(''); setCFreq('daily'); setCHour(String(new Date().getHours())); setCMin('0'); setCCustom(''); setCChan('all'); setMode('none'); };
  const resetReminderForm = () => { setRName(''); setRPrompt(''); setRDate(todayStr()); setRTime(currentTimeStr()); setRChan('all'); setMode('none'); };

  const handleCreateCron = () => {
    if (!cName || !cPrompt || !cronVal) return;
    createSchedule.mutate({ description: cName, prompt: cPrompt, cron: cronVal, timezone: cTz || undefined, channel: cChan }, { onSuccess: resetCronForm });
  };

  const handleCreateReminder = () => {
    if (!rName || !rPrompt || !rDate || !rTime) return;
    createReminder.mutate({ description: rName, prompt: rPrompt, fire_at: `${rDate}T${rTime}:00`, timezone: rTz || undefined, channel: rChan }, { onSuccess: resetReminderForm });
  };

  const startEdit = (s: Schedule) => { setEditKind('schedule'); setEName(s.description); setEPrompt(s.prompt); setECron(s.cron); setEditId(s.id); };
  const startEditReminder = (r: Reminder) => {
    setEditKind('reminder');
    setEName(r.description);
    setEPrompt(r.prompt);
    // Split the stored ISO into local-input-compatible date + time pieces.
    const d = new Date(r.fire_at);
    const pad = (n: number) => String(n).padStart(2, '0');
    setEDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    setETime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setEditId(r.id);
  };
  const cancelEdit = () => setEditId(null);
  const saveEdit = () => {
    if (!editId) return;
    if (editKind === 'schedule') {
      updateSchedule.mutate({ id: editId, description: eName, prompt: ePrompt, cron: eCron });
    } else {
      updateReminder.mutate({ id: editId, description: eName, prompt: ePrompt, fire_at: `${eDate}T${eTime}:00` });
    }
    setEditId(null);
  };

  return (
    <div className={`flex-1 flex flex-col min-w-0 ${bg}`}>
      {/* Header */}
      <div className={`px-4 py-2.5 flex items-center justify-between border-b ${dark ? 'border-slate-700' : 'border-gray-200'} shrink-0`}>
        <div className="flex items-center gap-2">
          <Clock className={`w-4 h-4 ${dark ? 'text-indigo-400' : 'text-indigo-600'}`} />
          <span className={`font-semibold text-sm ${t1}`}>Scheduler</span>
          {(schedules.length > 0 || reminders.length > 0) && (
            <span className={`text-xs ${t3}`}>{schedules.length} jobs, {reminders.length} reminders</span>
          )}
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => setMode(mode === 'cron' ? 'none' : 'cron')} className={btn('bg-indigo-600 hover:bg-indigo-500')}>
            <Plus className="w-3 h-3 inline -mt-0.5 mr-1" />Job
          </button>
          <button onClick={() => setMode(mode === 'reminder' ? 'none' : 'reminder')} className={btn('bg-amber-600 hover:bg-amber-500')}>
            <Bell className="w-3 h-3 inline -mt-0.5 mr-1" />Reminder
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* ── New cron job ── */}
        {mode === 'cron' && (
          <div className={`rounded border ${card} p-3 space-y-2`}>
            <div className="flex justify-between items-center">
              <span className={`text-xs font-semibold ${t1}`}>New Cron Job</span>
              <button onClick={() => setMode('none')} className={t3}><X className="w-3.5 h-3.5" /></button>
            </div>
            <input placeholder="Name" value={cName} onChange={e => setCName(e.target.value)} className={inp} />
            <textarea placeholder="What Prax should do each time" value={cPrompt} onChange={e => setCPrompt(e.target.value)} rows={2} className={inp} />
            <div className="flex flex-wrap gap-1.5 items-center">
              <select value={cFreq} onChange={e => setCFreq(e.target.value)} className={`w-32 ${sel}`}>
                {FREQ.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              {showHour && <>
                <span className={`text-xs ${t3}`}>at</span>
                <select value={cHour} onChange={e => setCHour(e.target.value)} className={`w-28 ${sel}`}>
                  {HOURS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                </select>
              </>}
              {showMinOnly && <>
                <span className={`text-xs ${t3}`}>at :</span>
                <select value={cMin} onChange={e => setCMin(e.target.value)} className={`w-16 ${sel}`}>
                  {[0, 5, 10, 15, 20, 30, 45].map(m => <option key={m} value={String(m)}>{String(m).padStart(2, '0')}</option>)}
                </select>
              </>}
              {cFreq === 'weekly' && <>
                <span className={`text-xs ${t3}`}>on</span>
                <select value={cDow} onChange={e => setCDow(e.target.value)} className={`w-28 ${sel}`}>
                  {DAYS.map((d, i) => <option key={i} value={String((i + 1) % 7)}>{d}</option>)}
                </select>
              </>}
              {cFreq === 'custom' && <input placeholder="0 9 * * 1-5" value={cCustom} onChange={e => setCCustom(e.target.value)} className={`w-36 font-mono ${inp}`} />}
            </div>
            {cronVal && <div className={`text-xs ${t3}`}>{describeCron(cronVal)} <code className={`ml-1 font-mono px-1 rounded ${dark ? 'bg-slate-700' : 'bg-gray-100'}`}>{cronVal}</code></div>}
            <div className="flex gap-1.5">
              <select value={cChan} onChange={e => setCChan(e.target.value)} className={`w-32 ${sel}`}>
                {CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <TimezonePicker value={cTz || userTz} onChange={setCTz} className={`w-52 ${sel}`} />
            </div>
            <button onClick={handleCreateCron} disabled={!cName || !cPrompt || !cronVal || createSchedule.isPending} className={btn('bg-indigo-600 hover:bg-indigo-500')}>
              {createSchedule.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        )}

        {/* ── New reminder ── */}
        {mode === 'reminder' && (
          <div className={`rounded border ${card} p-3 space-y-2`}>
            <div className="flex justify-between items-center">
              <span className={`text-xs font-semibold ${t1}`}>New Reminder</span>
              <button onClick={() => setMode('none')} className={t3}><X className="w-3.5 h-3.5" /></button>
            </div>
            <input placeholder="Name" value={rName} onChange={e => setRName(e.target.value)} className={inp} />
            <input placeholder="Message (delivered as-is)" value={rPrompt} onChange={e => setRPrompt(e.target.value)} className={inp} />
            <div className="flex gap-1.5 items-center">
              <input type="date" value={rDate} onChange={e => setRDate(e.target.value)} className={`w-36 ${inp}`} />
              <input type="time" value={rTime} onChange={e => setRTime(e.target.value)} className={`w-24 ${inp}`} />
              <select value={rChan} onChange={e => setRChan(e.target.value)} className={`w-32 ${sel}`}>
                {CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <TimezonePicker value={rTz || userTz} onChange={setRTz} className={`w-52 ${sel}`} />
            </div>
            <button onClick={handleCreateReminder} disabled={!rName || !rPrompt || !rDate || !rTime || createReminder.isPending} className={btn('bg-amber-600 hover:bg-amber-500')}>
              {createReminder.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        )}

        {/* ── Jobs list ── */}
        {schedules.length > 0 && (
          <div>
            <div className={`text-xs font-semibold uppercase tracking-wider mb-1.5 ${t3}`}><Timer className="w-3 h-3 inline mr-1" />Jobs</div>
            {schedules.map((s: Schedule) => (
              <div key={s.id} className={`rounded border ${card} p-2.5 mb-1.5 ${!s.enabled ? 'opacity-40' : ''}`}>
                {editId === s.id && editKind === 'schedule' ? (
                  <div className="space-y-1.5">
                    <input value={eName} onChange={e => setEName(e.target.value)} className={inp} />
                    <textarea value={ePrompt} onChange={e => setEPrompt(e.target.value)} rows={2} className={inp} />
                    <div className="flex gap-1.5 items-center">
                      <input value={eCron} onChange={e => setECron(e.target.value)} className={`w-36 font-mono ${inp}`} />
                      <button onClick={saveEdit} className="p-1 text-green-500"><Check className="w-3.5 h-3.5" /></button>
                      <button onClick={cancelEdit} className={`p-1 ${t3}`}><X className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-sm font-medium ${t1}`}>{s.description}</span>
                        <span className={`text-xs px-1 py-0.5 rounded ${dark ? 'bg-slate-700 text-indigo-400' : 'bg-indigo-50 text-indigo-700'}`}>{describeCron(s.cron)}</span>
                        {!s.enabled && <span className={`text-xs px-1 py-0.5 rounded ${dark ? 'bg-yellow-900/30 text-yellow-400' : 'bg-yellow-50 text-yellow-700'}`}>paused</span>}
                      </div>
                      <p className={`text-xs mt-0.5 ${t2} truncate`}>{s.prompt}</p>
                      <div className={`text-xs mt-1 ${t3} flex gap-2`}>
                        {s.next_run && <span>Next: {new Date(s.next_run).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                        {s.last_run && <span>Last: {new Date(s.last_run).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                      </div>
                    </div>
                    <div className="flex gap-0.5 shrink-0">
                      <button onClick={() => updateSchedule.mutate({ id: s.id, enabled: !s.enabled })} className={`p-1 rounded ${dark ? 'hover:bg-slate-700' : 'hover:bg-gray-200'}`} title={s.enabled ? 'Pause' : 'Resume'}>
                        {s.enabled ? <Pause className={`w-3.5 h-3.5 ${t3}`} /> : <Play className="w-3.5 h-3.5 text-green-500" />}
                      </button>
                      <button onClick={() => startEdit(s)} className={`p-1 rounded ${dark ? 'hover:bg-slate-700' : 'hover:bg-gray-200'}`}><Pencil className={`w-3.5 h-3.5 ${t3}`} /></button>
                      <button onClick={() => { if (confirm('Delete?')) deleteSchedule.mutate(s.id); }} className={`p-1 rounded ${dark ? 'hover:bg-red-900/30' : 'hover:bg-red-50'}`}><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Reminders list ── */}
        {reminders.length > 0 && (
          <div>
            <div className={`text-xs font-semibold uppercase tracking-wider mb-1.5 ${t3}`}><Bell className="w-3 h-3 inline mr-1" />Reminders</div>
            {reminders.map((r: Reminder) => (
              <div key={r.id} className={`rounded border ${card} p-2.5 mb-1.5`}>
                {editId === r.id && editKind === 'reminder' ? (
                  <div className="space-y-1.5">
                    <input value={eName} onChange={e => setEName(e.target.value)} className={inp} />
                    <input value={ePrompt} onChange={e => setEPrompt(e.target.value)} className={inp} />
                    <div className="flex gap-1.5 items-center">
                      <input type="date" value={eDate} onChange={e => setEDate(e.target.value)} className={`w-36 ${inp}`} />
                      <input type="time" value={eTime} onChange={e => setETime(e.target.value)} className={`w-24 ${inp}`} />
                      <button onClick={saveEdit} className="p-1 text-green-500"><Check className="w-3.5 h-3.5" /></button>
                      <button onClick={cancelEdit} className={`p-1 ${t3}`}><X className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className={`text-sm font-medium ${t1}`}>{r.description}</span>
                      <p className={`text-xs mt-0.5 ${t2} truncate`}>{r.prompt}</p>
                      <div className={`text-xs mt-1 ${t3} flex gap-2`}>
                        <span>{new Date(r.fire_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        {r.channel && <span>via {r.channel}</span>}
                      </div>
                    </div>
                    <div className="flex gap-0.5 shrink-0">
                      <button onClick={() => startEditReminder(r)} className={`p-1 rounded ${dark ? 'hover:bg-slate-700' : 'hover:bg-gray-200'}`}><Pencil className={`w-3.5 h-3.5 ${t3}`} /></button>
                      <button onClick={() => { if (confirm('Delete?')) deleteReminder.mutate(r.id); }} className={`p-1 rounded ${dark ? 'hover:bg-red-900/30' : 'hover:bg-red-50'}`}><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Empty ── */}
        {!isLoading && schedules.length === 0 && reminders.length === 0 && mode === 'none' && (
          <div className="flex flex-col items-center justify-center py-12">
            <Clock className={`w-8 h-8 mb-2 ${t3}`} />
            <p className={`text-sm ${t2}`}>No scheduled jobs</p>
            <p className={`text-xs mt-1 ${t3}`}>Create one above, or ask Prax in chat.</p>
          </div>
        )}
      </div>
    </div>
  );
}
