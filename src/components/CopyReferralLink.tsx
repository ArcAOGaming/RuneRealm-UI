import React, { useState } from 'react';
import { copyReferralLink } from '../utils/aoHelpers';
import { Theme } from '../constants/theme';

interface CopyReferralLinkProps {
  theme: Theme;
  modern?: boolean;
}

const CopyReferralLink: React.FC<CopyReferralLinkProps> = ({ theme, modern }) => {
  const [showCopiedNotification, setShowCopiedNotification] = useState(false);

  const handleCopyReferralLink = async () => {
    try {
      await copyReferralLink();
      setShowCopiedNotification(true);
      setTimeout(() => setShowCopiedNotification(false), 2000);
    } catch (error) {
      console.error('Failed to copy referral link:', error);
    }
  };

  return (
    <button
      onClick={handleCopyReferralLink}
      className={
        modern
          ? `min-w-[140px] px-6 py-2 rounded-full border border-orange-200/60 bg-white/70 shadow font-semibold flex items-center gap-2 text-black transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-orange-200`
          : `min-w-[140px] px-4 py-2 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} rounded-xl border ${theme.border} transition-all duration-300 hover:scale-105 flex items-center justify-center gap-2 text-sm whitespace-nowrap`
      }
    >
      <span className={modern ? 'text-lg font-bold' : ''}>🔗</span>
      <span>Referral Link</span>
      {showCopiedNotification && (
        <span className="text-green-400">✓</span>
      )}
    </button>
  );
};

export default CopyReferralLink;
