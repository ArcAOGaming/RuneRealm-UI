/**
 * Publishing a character to Arweave, through Turbo.
 *
 * Two uploads, in order: the sheet, then an atlas that names it. The atlas
 * carries the sheet's transaction id in `image`, so the pair is resolvable from
 * the atlas alone — whoever fetches it does not need to be told where the PNG
 * lives.
 *
 * `@ardrive/turbo-sdk` needs `crypto`, `buffer` and `stream` polyfilled in the
 * browser (via `arbundles`), which is why `vite.config.ts` carries a narrow
 * polyfill list. Loaded lazily so only somebody who actually publishes pays for
 * downloading it.
 */
import { getWallet } from './wallet';

/** What a published character consists of. */
export type PublishedSprite = {
  spriteTxId: string;
  atlasTxId: string;
};

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('the sheet could not be encoded as a PNG'));
    }, 'image/png');
  });
}

/**
 * Upload the sheet and its atlas.
 *
 * `buildAtlas` is passed in rather than imported so this module stays about
 * uploading and the atlas stays about geometry.
 */
export async function uploadSprite(
  sheet: HTMLCanvasElement,
  buildAtlas: (imageTxId: string) => unknown,
): Promise<PublishedSprite> {
  const wallet = getWallet();
  if (!wallet) {
    throw new Error('No Arweave wallet. Connect one before publishing.');
  }

  const { TurboFactory, ArconnectSigner } = await import('@ardrive/turbo-sdk/web');
  const signer = new ArconnectSigner(
    wallet as ConstructorParameters<typeof ArconnectSigner>[0],
  );
  const turbo = TurboFactory.authenticated({ signer });

  const put = async (data: Uint8Array, tags: { name: string; value: string }[]) => {
    const buffer = Buffer.from(data);
    const { id } = await turbo.uploadFile({
      fileStreamFactory: () => buffer,
      fileSizeFactory: () => buffer.byteLength,
      dataItemOpts: { tags },
    });
    if (typeof id !== 'string' || id.length !== 43) {
      throw new Error(`Turbo answered "${id}", which is not a transaction id`);
    }
    return id;
  };

  const png = new Uint8Array(await (await canvasToBlob(sheet)).arrayBuffer());
  const spriteTxId = await put(png, [
    { name: 'Content-Type', value: 'image/png' },
    { name: 'App-Name', value: 'RuneRealm' },
    { name: 'Type', value: 'Character-Sheet' },
  ]);

  // Second, and only now: the atlas names the sheet, so it cannot be built
  // until the sheet has an id. A failure here leaves an orphaned PNG on
  // Arweave, which is harmless — nothing points at it — whereas an atlas
  // naming a sheet that failed to upload would be a broken character.
  const atlas = new TextEncoder().encode(JSON.stringify(buildAtlas(spriteTxId)));
  const atlasTxId = await put(atlas, [
    { name: 'Content-Type', value: 'application/json' },
    { name: 'App-Name', value: 'RuneRealm' },
    { name: 'Type', value: 'Character-Atlas' },
    { name: 'Sheet', value: spriteTxId },
  ]);

  return { spriteTxId, atlasTxId };
}
