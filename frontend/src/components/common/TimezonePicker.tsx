/**
 * TimezonePicker — grouped dropdown of common IANA timezones.
 */

const TZ_GROUPS: { label: string; zones: { value: string; label: string }[] }[] = [
  {
    label: 'Americas',
    zones: [
      { value: 'America/New_York', label: 'Eastern (New York)' },
      { value: 'America/Chicago', label: 'Central (Chicago)' },
      { value: 'America/Denver', label: 'Mountain (Denver)' },
      { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
      { value: 'America/Anchorage', label: 'Alaska' },
      { value: 'Pacific/Honolulu', label: 'Hawaii' },
      { value: 'America/Toronto', label: 'Toronto' },
      { value: 'America/Vancouver', label: 'Vancouver' },
      { value: 'America/Mexico_City', label: 'Mexico City' },
      { value: 'America/Sao_Paulo', label: 'S\u00e3o Paulo' },
      { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
      { value: 'America/Bogota', label: 'Bogot\u00e1' },
    ],
  },
  {
    label: 'Europe',
    zones: [
      { value: 'Europe/London', label: 'London (GMT/BST)' },
      { value: 'Europe/Paris', label: 'Paris / Berlin / Rome' },
      { value: 'Europe/Amsterdam', label: 'Amsterdam' },
      { value: 'Europe/Madrid', label: 'Madrid' },
      { value: 'Europe/Zurich', label: 'Zurich' },
      { value: 'Europe/Stockholm', label: 'Stockholm' },
      { value: 'Europe/Warsaw', label: 'Warsaw' },
      { value: 'Europe/Athens', label: 'Athens' },
      { value: 'Europe/Moscow', label: 'Moscow' },
      { value: 'Europe/Istanbul', label: 'Istanbul' },
    ],
  },
  {
    label: 'Asia & Pacific',
    zones: [
      { value: 'Asia/Dubai', label: 'Dubai' },
      { value: 'Asia/Kolkata', label: 'India (Kolkata)' },
      { value: 'Asia/Bangkok', label: 'Bangkok' },
      { value: 'Asia/Singapore', label: 'Singapore' },
      { value: 'Asia/Shanghai', label: 'China (Shanghai)' },
      { value: 'Asia/Hong_Kong', label: 'Hong Kong' },
      { value: 'Asia/Tokyo', label: 'Tokyo' },
      { value: 'Asia/Seoul', label: 'Seoul' },
      { value: 'Australia/Sydney', label: 'Sydney' },
      { value: 'Australia/Melbourne', label: 'Melbourne' },
      { value: 'Pacific/Auckland', label: 'Auckland' },
    ],
  },
  {
    label: 'Africa & Middle East',
    zones: [
      { value: 'Africa/Cairo', label: 'Cairo' },
      { value: 'Africa/Lagos', label: 'Lagos' },
      { value: 'Africa/Johannesburg', label: 'Johannesburg' },
      { value: 'Africa/Nairobi', label: 'Nairobi' },
      { value: 'Asia/Jerusalem', label: 'Jerusalem' },
      { value: 'Asia/Riyadh', label: 'Riyadh' },
    ],
  },
];

interface Props {
  value: string;
  onChange: (tz: string) => void;
  className?: string;
}

export function TimezonePicker({ value, onChange, className }: Props) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={className}>
      <option value="UTC">UTC</option>
      {TZ_GROUPS.map(group => (
        <optgroup key={group.label} label={group.label}>
          {group.zones.map(tz => (
            <option key={tz.value} value={tz.value}>{tz.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
