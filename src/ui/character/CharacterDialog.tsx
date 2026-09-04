/**
 * The character editor, laid over whatever page you opened it from.
 *
 * It is a modal and not a route because editing your character is an aside:
 * you are looking at your companion or your collection, you want different
 * hair, and you want to still be looking at the same thing afterwards. The
 * standalone screen still exists for anyone who deep-links to it.
 *
 * Nothing is lost by dismissing it. Every change is written to the per-wallet
 * draft in `CharacterEditor` as it is made, so closing the dialog — by the
 * backdrop, Escape, or Cancel — keeps the work and only skips the signature.
 */
import { Dialog } from '../Dialog';
import { CharacterEditor } from './CharacterEditor';

export function CharacterDialog({ element, onClose }: {
  /** Faction/companion element, so the dialog inherits the right accent. */
  element?: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      title="Your character"
      element={element}
      onClose={onClose}
      size="xl"
    >
      <p className="mt-1 text-[12px] leading-snug text-faint">
        The sprite the room draws. Clothing and colours are saved as game data,
        so changing them costs one ordinary signature and no upload.
      </p>
      <div className="mt-4">
        <CharacterEditor variant="dialog" onSaved={onClose} />
      </div>
    </Dialog>
  );
}
