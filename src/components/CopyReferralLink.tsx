import React, { useState } from 'react';
import { copyReferralLink } from '../utils/aoHelpers';
import { Theme } from '../constants/theme';

interface CopyReferralLinkProps {
  theme: Theme;
}

const CopyReferralLink: React.FC<CopyReferralLinkProps> = ({ theme }) => {
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
      className={`w-full px-4 py-2 ${theme.buttonBg} ${theme.buttonHover} ${theme.text} rounded-xl border ${theme.border} transition-all duration-300 hover:scale-105 flex items-center justify-center gap-2 text-sm`}
    >
      <span>🔗</span>
      <span>Referral Link</span>
      {showCopiedNotification && (
        <span className="text-green-400">✓</span>
      )}
    </button>
  );
};

export default CopyReferralLink;
