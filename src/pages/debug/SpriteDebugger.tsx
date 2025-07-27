import React, { useState, useCallback, useRef, useEffect } from 'react';
import MonsterSpriteView, { EffectType } from '../../components/MonsterSpriteView';
import { useWallet } from '../../contexts/WalletContext';
import { currentTheme } from '../../constants/theme';

// Animation types matching MonsterSpriteView
type AnimationType = 'walkRight' | 'walkLeft' | 'walkUp' | 'walkDown' | 'attack1' | 'attack2' | 
                    'idle' | 'sleep' | 'eat' | 'train' | 'play' | 'happy';

interface SpriteDebuggerProps {
  theme: any;
}

const SpriteDebugger: React.FC<SpriteDebuggerProps> = ({ theme }) => {
  const { darkMode } = useWallet();
  
  // Timeout ref for one-shot animations
  const oneShotTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // State variables
  const [selectedSprite, setSelectedSprite] = useState('0_gQ7rNpxD8S4wZBE_DZs3adWfZMsBIuo8fwvH3SwL0');
  const [currentAnimation, setCurrentAnimation] = useState<AnimationType>('idle');
  const [animationControl, setAnimationControl] = useState<{ type: 'perpetual' | 'duration' | 'loops' | 'once', value?: number }>({ type: 'perpetual' });
  const [defaultAnimation, setDefaultAnimation] = useState<AnimationType>('idle');
  const [effect, setEffect] = useState<EffectType>(null);
  const [showOpponent, setShowOpponent] = useState(false);
  const [scale, setScale] = useState(1.0);
  const [isPlayingOneShot, setIsPlayingOneShot] = useState(false);
  
  // Animation control settings
  const [durationValue, setDurationValue] = useState(4000); // 4 seconds default
  const [loopValue, setLoopValue] = useState(3); // 3 loops default
  
  // Logging
  const [animationLog, setAnimationLog] = useState<string[]>([]);
  const [effectLog, setEffectLog] = useState<string[]>([]);

  // Available sprites based on actual files in assets/sprites directory
  const availableSprites = [
    { name: 'Sprite 1', file: '0_gQ7rNpxD8S4wZBE_DZs3adWfZMsBIuo8fwvH3SwL0' },
    { name: 'Sprite 2', file: 'Zt8LmHGVIziXhzjqBhEAWLuGetcDitFKbfaJROkyZks' },
    { name: 'Sprite 3', file: 'p90BYY1O3BS3VVzdZETr-hG6jkA3kwo8l0h3aQ2UFoc' },
    { name: 'Sprite 4', file: 'wUo47CacsMRFFizJqUhSj75Rczg3f_MvHs4ytfPtCjQ' }
  ];

  // Default animations organized with proper left/right pairing
  const defaultAnimations = [
    // Row 1: Idle animations
    { name: 'Idle Left', animation: 'idleLeft' as AnimationType, isLeft: true, side: 'left' },
    { name: 'Idle Right', animation: 'idleRight' as AnimationType, isLeft: false, side: 'right' },
    
    // Row 2: Walk Up/Down (Up on left, Down on right as requested)
    { name: 'Walk Up', animation: 'walkUp' as AnimationType, isLeft: false, side: 'left' },
    { name: 'Walk Down', animation: 'walkDown' as AnimationType, isLeft: false, side: 'right' },
    
    // Row 3: Walk Left/Right
    { name: 'Walk Left', animation: 'walkLeft' as AnimationType, isLeft: false, side: 'left' },
    { name: 'Walk Right', animation: 'walkRight' as AnimationType, isLeft: false, side: 'right' },
    
    // Row 4: Attack 1 Left/Right
    { name: 'Attack 1 Left', animation: 'attack1' as AnimationType, isLeft: true, side: 'left' },
    { name: 'Attack 1 Right', animation: 'attack1' as AnimationType, isLeft: false, side: 'right' },
    
    // Row 5: Attack 2 Left/Right
    { name: 'Attack 2 Left', animation: 'attack2' as AnimationType, isLeft: true, side: 'left' },
    { name: 'Attack 2 Right', animation: 'attack2' as AnimationType, isLeft: false, side: 'right' }
  ];
  const movementAnimations: AnimationType[] = ['walkRight', 'walkLeft', 'walkUp', 'walkDown'];
  const attackAnimations: AnimationType[] = ['attack1', 'attack2'];
  
  const effects: EffectType[] = [
    null, 'Small Heal', 'Medium Heal', 'Large Heal', 'Full Heal', 
    'Revive', 'Attack Boost', 'Shield Boost'
  ];

  // Move types that would trigger attack animations in real battles
  const moveTypes = [
    { name: 'Physical Attack', animation: 'attack1' as AnimationType },
    { name: 'Special Attack', animation: 'attack2' as AnimationType },
    { name: 'Quick Strike', animation: 'attack1' as AnimationType },
    { name: 'Power Slam', animation: 'attack2' as AnimationType },
  ];

  // Auto-return to default animation after one-shot animations
  useEffect(() => {
    if (isPlayingOneShot) {
      // Clear any existing timeout
      if (oneShotTimeoutRef.current) {
        clearTimeout(oneShotTimeoutRef.current);
      }
      
      // Set timeout to return to default animation (matches real game timing)
      oneShotTimeoutRef.current = setTimeout(() => {
        setCurrentAnimation(defaultAnimation);
        setIsPlayingOneShot(false);
        const timestamp = new Date().toLocaleTimeString();
        setAnimationLog(prev => [`${timestamp}: Returned to default animation '${defaultAnimation}'`, ...prev.slice(0, 9)]);
      }, 2000); // 2 seconds matches typical move animation duration
    }
    
    return () => {
      if (oneShotTimeoutRef.current) {
        clearTimeout(oneShotTimeoutRef.current);
      }
    };
  }, [isPlayingOneShot, defaultAnimation]);

  // Event handlers
  const handleAnimationComplete = useCallback(() => {
    const timestamp = new Date().toLocaleTimeString();
    setAnimationLog(prev => [`${timestamp}: Animation '${currentAnimation}' completed`, ...prev.slice(0, 9)]);
  }, [currentAnimation]);

  const handleEffectComplete = useCallback(() => {
    const timestamp = new Date().toLocaleTimeString();
    setEffectLog(prev => [`${timestamp}: Effect '${effect}' completed`, ...prev.slice(0, 9)]);
    setEffect(null); // Clear effect after completion
  }, [effect]);

  // Set default animation (perpetual) with proper direction handling
  const setDefaultAnimationHandler = (animation: AnimationType, name: string, isLeft: boolean = false) => {
    setDefaultAnimation(animation);
    setCurrentAnimation(animation);
    setAnimationControl({ type: 'perpetual' }); // Default animations run perpetually
    setIsPlayingOneShot(false);
    
    // Handle direction for all animations that support left/right facing
    if (isLeft) {
      setShowOpponent(true); // Use opponent view for left-facing
    } else {
      setShowOpponent(false); // Use normal view for right-facing
    }
    
    const timestamp = new Date().toLocaleTimeString();
    setAnimationLog(prev => [`${timestamp}: Set perpetual animation '${name}' (${animation}) facing ${isLeft ? 'left' : 'right'}`, ...prev.slice(0, 9)]);
  };

  // Trigger controlled animation with flexible control options
  const triggerControlledAnimation = (animation: AnimationType, controlType: 'once' | 'duration' | 'loops', type: string, isLeft: boolean = false) => {
    setCurrentAnimation(animation);
    
    // Set up animation control based on type
    let control;
    switch (controlType) {
      case 'once':
        control = { type: 'once' as const };
        break;
      case 'duration':
        control = { type: 'duration' as const, value: durationValue };
        break;
      case 'loops':
        control = { type: 'loops' as const, value: loopValue };
        break;
    }
    
    setAnimationControl(control);
    setIsPlayingOneShot(true);
    
    // Set direction for the animation
    if (isLeft) {
      setShowOpponent(true); // Use opponent view for left-facing
    } else {
      setShowOpponent(false); // Use normal view for right-facing
    }
    
    const controlDesc = controlType === 'duration' ? `${durationValue}ms` : controlType === 'loops' ? `${loopValue} loops` : 'once';
    const timestamp = new Date().toLocaleTimeString();
    setAnimationLog(prev => [`${timestamp}: Triggered ${type} '${animation}' (${controlDesc}) facing ${isLeft ? 'left' : 'right'}`, ...prev.slice(0, 9)]);
  };

  // Trigger effect animation
  const triggerEffect = (effectType: EffectType) => {
    if (effectType) {
      setEffect(effectType);
      const timestamp = new Date().toLocaleTimeString();
      setEffectLog(prev => [`${timestamp}: Triggered effect '${effectType}'`, ...prev.slice(0, 9)]);
    }
  };

  const clearLogs = () => {
    setAnimationLog([]);
    setEffectLog([]);
  };

  return (
    <div className="space-y-6">
      <div className="text-white">
        <h2 className="text-2xl font-bold mb-4">Sprite Debugger</h2>
        <p className="text-gray-300 mb-6">
          Test monster sprite animations, effects, and moves with realistic controls based on the actual game implementation.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sprite Display */}
        <div className="bg-black/30 rounded-lg p-6">
          <h3 className="text-xl font-semibold text-white mb-4">Sprite Display</h3>
          {/* Monster Sprite Display */}
          <div className="flex justify-center mb-6">
            <div 
              className="relative border-2 border-gray-600 rounded-lg overflow-hidden"
              style={{ 
                width: '128px', 
                height: '128px',
backgroundColor: '#1a1a2e'
              }}
            >
              <MonsterSpriteView
                sprite={selectedSprite}
                currentAnimation={currentAnimation}
                animationControl={animationControl}
                effect={effect}
                isOpponent={showOpponent}
                scale={scale}
                containerWidth={128}
                containerHeight={128}
                onAnimationComplete={handleAnimationComplete}
                onEffectComplete={handleEffectComplete}
              />
            </div>
          </div>

          {/* Scale Controls */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-purple-200">
              Monster Scale: {scale.toFixed(2)}x
            </label>
            <div className="flex gap-2 items-center">
              <button
                onClick={() => setScale(prev => Math.max(0.5, prev - 0.25))}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium"
                disabled={scale <= 0.5}
              >
                -0.25
              </button>
              <div className="flex-1 text-center text-sm text-gray-300">
                Scale: {scale.toFixed(2)}x
              </div>
              <button
                onClick={() => setScale(prev => Math.min(2.0, prev + 0.25))}
                className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium"
                disabled={scale >= 2.0}
              >
                +0.25
              </button>
            </div>
            <div className="text-xs text-gray-400 text-center">
              Range: 0.5x to 2.0x
            </div>
          </div>
        </div>

        {/* Controls Panel */}
        <div className="bg-black/30 rounded-lg p-6 space-y-4">
          <h3 className="text-xl font-semibold text-white mb-4">Controls</h3>

          {/* Sprite Selection */}
          <div>
            <label className="block text-sm font-medium text-purple-200 mb-2">Sprite</label>
            <select
              value={selectedSprite}
              onChange={(e) => setSelectedSprite(e.target.value)}
              className="w-full p-2 bg-black/50 border border-purple-400/30 rounded text-white"
            >
              {availableSprites.map(sprite => (
                <option key={sprite.file} value={sprite.file}>
                  {sprite.name}
                </option>
              ))}
            </select>
          </div>

          {/* Default Animation (Repeating) */}
          <div>
            <label className="block text-sm font-medium text-purple-200 mb-2">Default Animation (Repeating)</label>
            <div className="space-y-2">
              {/* Group animations into rows of 2 */}
              {Array.from({ length: Math.ceil(defaultAnimations.length / 2) }, (_, rowIndex) => {
                const startIndex = rowIndex * 2;
                const rowAnimations = defaultAnimations.slice(startIndex, startIndex + 2);
                
                return (
                  <div key={rowIndex} className="grid grid-cols-2 gap-2">
                    {rowAnimations.map(animObj => {
                      const isActive = defaultAnimation === animObj.animation && 
                        ((animObj.isLeft && showOpponent) || (!animObj.isLeft && !showOpponent));
                      
                      return (
                        <button
                          key={animObj.name}
                          onClick={() => setDefaultAnimationHandler(animObj.animation, animObj.name, animObj.isLeft)}
                          className={`p-2 rounded text-sm ${
                            isActive
                              ? 'bg-purple-600 text-white'
                              : 'bg-black/50 border border-purple-400/30 text-purple-200 hover:bg-purple-600/20'
                          } ${animObj.side === 'left' ? 'text-left' : 'text-right'}`}
                        >
                          {animObj.name}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Animation Control Settings */}
          <div>
            <label className="block text-sm font-medium text-purple-200 mb-2">Animation Control Settings</label>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Duration (ms)</label>
                  <input
                    type="number"
                    value={durationValue}
                    onChange={(e) => setDurationValue(Number(e.target.value))}
                    className="w-full p-1 text-sm bg-black/50 border border-purple-400/30 rounded text-white"
                    min="1000"
                    max="30000"
                    step="1000"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Loop Count</label>
                  <input
                    type="number"
                    value={loopValue}
                    onChange={(e) => setLoopValue(Number(e.target.value))}
                    className="w-full p-1 text-sm bg-black/50 border border-purple-400/30 rounded text-white"
                    min="1"
                    max="20"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Movement Animations */}
          <div>
            <label className="block text-sm font-medium text-purple-200 mb-2">Movement Animations</label>
            <div className="space-y-2">
              {/* Walk Up/Down row */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => triggerControlledAnimation('walkUp', 'once', 'movement', false)}
                  className="p-2 rounded text-sm bg-black/50 border border-blue-400/30 text-blue-200 hover:bg-blue-600/20 text-left"
                >
                  Walk Up (Once)
                </button>
                <button
                  onClick={() => triggerControlledAnimation('walkDown', 'once', 'movement', false)}
                  className="p-2 rounded text-sm bg-black/50 border border-blue-400/30 text-blue-200 hover:bg-blue-600/20 text-right"
                >
                  Walk Down (Once)
                </button>
              </div>
              {/* Walk Left/Right row */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => triggerControlledAnimation('walkLeft', 'duration', 'movement', false)}
                  className="p-2 rounded text-sm bg-black/50 border border-green-400/30 text-green-200 hover:bg-green-600/20 text-left"
                >
                  Walk Left ({durationValue}ms)
                </button>
                <button
                  onClick={() => triggerControlledAnimation('walkRight', 'loops', 'movement', false)}
                  className="p-2 rounded text-sm bg-black/50 border border-yellow-400/30 text-yellow-200 hover:bg-yellow-600/20 text-right"
                >
                  Walk Right ({loopValue} loops)
                </button>
              </div>
            </div>
          </div>

          {/* Attack Animations */}
          <div>
            <label className="block text-sm font-medium text-purple-200 mb-2">Attack Animations</label>
            <div className="space-y-2">
              {/* Attack 1 Left/Right row */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => triggerControlledAnimation('attack1', 'once', 'attack', true)}
                  className="p-2 rounded text-sm bg-black/50 border border-red-400/30 text-red-200 hover:bg-red-600/20 text-left"
                >
                  Attack 1 Left (Once)
                </button>
                <button
                  onClick={() => triggerControlledAnimation('attack1', 'duration', 'attack', false)}
                  className="p-2 rounded text-sm bg-black/50 border border-green-400/30 text-green-200 hover:bg-green-600/20 text-right"
                >
                  Attack 1 Right ({durationValue}ms)
                </button>
              </div>
              {/* Attack 2 Left/Right row */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => triggerControlledAnimation('attack2', 'loops', 'attack', true)}
                  className="p-2 rounded text-sm bg-black/50 border border-yellow-400/30 text-yellow-200 hover:bg-yellow-600/20 text-left"
                >
                  Attack 2 Left ({loopValue} loops)
                </button>
                <button
                  onClick={() => triggerControlledAnimation('attack2', 'once', 'attack', false)}
                  className="p-2 rounded text-sm bg-black/50 border border-red-400/30 text-red-200 hover:bg-red-600/20 text-right"
                >
                  Attack 2 Right (Once)
                </button>
              </div>
            </div>
          </div>

          {/* Opponent Toggle */}
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="opponent-toggle"
              checked={showOpponent}
              onChange={(e) => setShowOpponent(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="opponent-toggle" className="text-sm font-medium text-purple-200">
              Show as Opponent
            </label>
          </div>

          {/* Effects */}
          <div>
            <label className="block text-sm font-medium text-purple-200 mb-2">Effects (One-shot)</label>
            <div className="grid grid-cols-2 gap-2">
              {effects.filter(e => e !== null).map(effectType => (
                <button
                  key={effectType}
                  onClick={() => triggerEffect(effectType)}
                  className="p-2 rounded text-sm bg-black/50 border border-green-400/30 text-green-200 hover:bg-green-600/20"
                >
                  {effectType}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Event Logs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Animation Log */}
        <div className="bg-black/30 rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-lg font-semibold text-white">Animation Events</h4>
            <button
              onClick={clearLogs}
              className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded"
            >
              Clear
            </button>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {animationLog.length === 0 ? (
              <p className="text-purple-300 text-sm">No animation events yet...</p>
            ) : (
              animationLog.map((log, index) => (
                <div key={index} className="text-sm text-green-300 font-mono">
                  {log}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Effect Log */}
        <div className="bg-black/30 rounded-lg p-6">
          <h3 className="text-xl font-semibold text-white mb-4">Debug Info</h3>
          <div className="space-y-4">
            <div className="text-sm text-gray-300">
              <div><strong>Current Sprite:</strong> {selectedSprite}</div>
              <div><strong>Current Animation:</strong> {currentAnimation}</div>
              <div><strong>Default Animation:</strong> {defaultAnimation}</div>
              <div><strong>Effect:</strong> {effect || 'None'}</div>
              <div><strong>Container:</strong> 256x256 (4x sprite size)</div>
              <div><strong>Scale:</strong> {scale.toFixed(2)}x</div>
              <div><strong>Is Opponent:</strong> {showOpponent ? 'Yes' : 'No'}</div>
              <div><strong>Playing One-shot:</strong> {isPlayingOneShot ? 'Yes' : 'No'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Debug Info */}
      <div className="bg-black/30 rounded-lg p-4">
        <h4 className="text-lg font-semibold text-white mb-3">Current State</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-purple-300">Sprite:</span>
            <span className="text-white ml-2">{selectedSprite}</span>
          </div>
          <div>
            <span className="text-purple-300">Animation:</span>
            <span className="text-white ml-2">{currentAnimation || 'None'}</span>
          </div>
          <div>
            <span className="text-purple-300">One-shot:</span>
            <span className="text-white ml-2">{isPlayingOneShot ? 'Yes' : 'No'}</span>
          </div>
          <div>
            <span className="text-purple-300">Effect:</span>
            <span className="text-white ml-2">{effect || 'None'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SpriteDebugger;
