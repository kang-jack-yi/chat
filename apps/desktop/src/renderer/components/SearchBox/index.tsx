import { Input } from "antd";
import { Search } from "lucide-react";

export interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

export default function SearchBox({ value, onChange, placeholder }: SearchBoxProps) {
  return (
    <Input
      allowClear
      value={value}
      prefix={<Search size={15} className="text-[var(--app-text-tertiary)]" />}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="mx-4 mb-3 !w-auto !rounded-xl !border !border-[var(--app-line)] !bg-[var(--app-surface)] !shadow-[0_2px_8px_rgba(39,48,67,.03)] hover:!border-[var(--app-primary)]"
    />
  );
}
