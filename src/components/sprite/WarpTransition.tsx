import React, { useEffect, useState } from 'react';

interface WarpTransitionProps {
  show: boolean;
  onComplete?: () => void;
}

const WarpTransition: React.FC<WarpTransitionProps> = ({ show, onComplete }) => {
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    if (show) {
      // Start animation
      setOpacity(1);
      
      // After animation completes
      const timeout = setTimeout(() => {
        if (onComplete) {
          onComplete();
        }
        // Keep black screen for a moment before fading out
        setTimeout(() => {
          setOpacity(0);
        }, 500);
      }, 1000);

      return () => clearTimeout(timeout);
    }
  }, [show, onComplete]);

  if (!show && opacity === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'black',
        opacity,
        transition: 'opacity 1s ease-in-out',
        pointerEvents: 'none',
        zIndex: 9999,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          fontSize: '24px',
          color: 'white',
          opacity: opacity,
          transform: `scale(${1 + opacity * 2})`,
          transition: 'all 1s ease-in-out',
        }}
      >
        Warping...
      </div>
    </div>
  );
};

export default WarpTransition;
