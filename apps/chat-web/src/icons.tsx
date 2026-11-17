import type { ReactNode } from "react";

const S = ({ children, size = 24 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export const BrandMark = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
    <rect x="4" y="6.5" width="17" height="19" rx="6.5" fill="var(--text-1)" />
    <circle cx="25.5" cy="21.5" r="3.2" fill="var(--accent)" />
  </svg>
);
export const IconMenu = () => <S><path d="M4 7h16M4 12h16M4 17h10" /></S>;
export const IconMic = ({ size = 24 }: { size?: number }) => (
  <S size={size}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></S>
);
export const IconPlus = () => <S><path d="M12 5v14M5 12h14" /></S>;
export const IconKeyboard = () => (
  <S><rect x="3" y="6" width="18" height="12" rx="2.5" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></S>
);
export const IconSend = () => <S><path d="M12 19V5M6 11l6-6 6 6" /></S>;
export const IconMore = () => <S><path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={2.6} /></S>;
export const IconEdit = () => <S><path d="M4 20h4L19 9l-4-4L4 16z" /></S>;
