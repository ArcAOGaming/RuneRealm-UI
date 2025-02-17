import React, { useState, useCallback } from 'react';
import { MonsterStats } from '../utils/aoHelpers';
import { Gateway } from '../constants/Constants';
import { CARD_LAYOUT, CARD_ZOOM } from '../constants/CardLayout';

interface MonsterCardDisplayProps {
  monster: MonsterStats;
  className?: string;
}

export const MonsterCardDisplay: React.FC<MonsterCardDisplayProps> = ({ monster, className = '' }) => {
  const [isZoomed, setIsZoomed] = useState(false);
  const basePath = '/src/assets/Monsters/cards';

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsZoomed(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsZoomed(false);
  }, []);

  // Get element-specific images
  const elementType = monster.elementType?.toLowerCase() as keyof typeof CARD_LAYOUT.ELEMENT_IMAGES || 'air';
  const elementImages = CARD_LAYOUT.ELEMENT_IMAGES[elementType];

  const renderCard = (scale = 1) => (
    <div 
      className={`relative w-full aspect-[2.5/3.5] ${className}`}
      style={{
        transform: `scale(${scale})`,
        transition: `transform ${CARD_ZOOM.DURATION}`,
        transformOrigin: 'center center'
      }}
    >
      {/* Background */}
      <img
        src={`${basePath}/${CARD_LAYOUT.LAYERS.BACKGROUND}/${elementImages.background}`}
        alt="Card Background"
        className="absolute inset-0 w-full h-full object-contain"
        style={{ zIndex: CARD_LAYOUT.Z_INDEX.BACKGROUND }}
      />

      {/* Frame */}
      <img
        src={`${basePath}/${CARD_LAYOUT.LAYERS.FRAME}/${elementImages.frame}`}
        alt="Card Frame"
        className="absolute inset-0 w-full h-full object-contain"
        style={{ zIndex: CARD_LAYOUT.Z_INDEX.FRAME }}
      />

      {/* Element Type */}
      <img
        src={`${basePath}/${CARD_LAYOUT.LAYERS.ELEMENT}/${elementImages.type}`}
        alt="Element Type"
        className="absolute inset-0 w-full h-full object-contain"
        style={{ zIndex: CARD_LAYOUT.Z_INDEX.ELEMENT }}
      />

      {/* Level Image */}
      <img
        src={`${basePath}/${CARD_LAYOUT.LAYERS.LEVEL}/${elementImages.level}`}
        alt="Level Background"
        className="absolute inset-0 w-full h-full object-contain"
        style={{ zIndex: CARD_LAYOUT.Z_INDEX.LEVEL_IMAGE }}
      />

      {/* Level Text */}
      <div
        className="absolute flex items-center justify-center text-white"
        style={{
          top: CARD_LAYOUT.POSITIONS.LEVEL.TOP,
          left: CARD_LAYOUT.POSITIONS.LEVEL.LEFT,
          width: CARD_LAYOUT.POSITIONS.LEVEL.WIDTH,
          zIndex: CARD_LAYOUT.Z_INDEX.LEVEL_TEXT,
          fontFamily: CARD_LAYOUT.FONTS.LEVEL.FAMILY,
          fontSize: CARD_LAYOUT.FONTS.LEVEL.SIZE,
          fontWeight: CARD_LAYOUT.FONTS.LEVEL.WEIGHT,
          color: CARD_LAYOUT.FONTS.LEVEL.COLOR
        }}
      >
        Lv.{monster.level}
      </div>

      {/* Monster Image */}
      {monster.image && (
        <img
          src={`${Gateway}${monster.image}`}
          alt={monster.name}
          className="absolute object-contain"
          style={{
            top: CARD_LAYOUT.POSITIONS.MONSTER.TOP,
            left: CARD_LAYOUT.POSITIONS.MONSTER.LEFT,
            width: CARD_LAYOUT.POSITIONS.MONSTER.WIDTH,
            zIndex: CARD_LAYOUT.Z_INDEX.MONSTER
          }}
        />
      )}

      {/* Stats */}
      <div
        className="absolute flex justify-between"
        style={{
          top: CARD_LAYOUT.POSITIONS.STATS.TOP,
          left: CARD_LAYOUT.POSITIONS.STATS.LEFT,
          width: CARD_LAYOUT.POSITIONS.STATS.WIDTH,
          zIndex: CARD_LAYOUT.Z_INDEX.STATS,
          fontFamily: CARD_LAYOUT.FONTS.STATS.FAMILY,
          fontSize: CARD_LAYOUT.FONTS.STATS.SIZE,
          fontWeight: CARD_LAYOUT.FONTS.STATS.WEIGHT,
          color: CARD_LAYOUT.FONTS.STATS.COLOR
        }}
      >
        <span>{monster.attack}</span>
        <span>{monster.speed}</span>
        <span>{monster.defense}</span>
        <span>{monster.health}</span>
      </div>

      {/* Regular Move */}
      <img
        src={`${basePath}/${CARD_LAYOUT.LAYERS.MOVES}/regular/${CARD_LAYOUT.INITIAL_IMAGES.MOVES.regular}`}
        alt="Regular Move"
        className="absolute inset-0 w-full h-full object-contain"
        style={{ zIndex: CARD_LAYOUT.Z_INDEX.MOVES }}
      />

      {/* Signature Move */}
      <img
        src={`${basePath}/${CARD_LAYOUT.LAYERS.MOVES}/signature/${CARD_LAYOUT.INITIAL_IMAGES.MOVES.signature}`}
        alt="Signature Move"
        className="absolute inset-0 w-full h-full object-contain"
        style={{ zIndex: CARD_LAYOUT.Z_INDEX.MOVES }}
      />

      {/* Monster Name */}
      <img
        src={`${basePath}/${CARD_LAYOUT.LAYERS.NAME}/${CARD_LAYOUT.INITIAL_IMAGES.NAME}`}
        alt="Monster Name"
        className="absolute inset-0 w-full h-full object-contain"
        style={{ zIndex: CARD_LAYOUT.Z_INDEX.NAME }}
      />
    </div>
  );

  if (isZoomed) {
    return (
      <div 
        className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-80"
        style={{ zIndex: CARD_ZOOM.Z_INDEX }}
        onClick={handleClose}
      >
        <div className="max-w-2xl w-full p-4">
          {renderCard(CARD_ZOOM.SCALE)}
        </div>
      </div>
    );
  }

  return (
    <div onClick={handleClick}>
      {renderCard()}
    </div>
  );
};
