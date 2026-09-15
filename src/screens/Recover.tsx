import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/game';
import { useGame } from '../state/gameContext';
import { Button, ErrorNote, Panel } from '../ui/primitives';
import { Shield } from '../ui/icons';

const inputClass = 'h-11 w-full rounded-[3px] border border-edge bg-raised px-3 font-mono text-xs text-ink outline-none focus:border-element/60';

export default function Recover() {
  const {
    address, connect, connecting, run, isPending, writePhase, transaction,
  } = useGame();
  const [account, setAccount] = useState('');
  const [controller, setController] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const recovery = transaction('pass:recover');
  useEffect(() => { if (address && !controller) setController(address); }, [address, controller]);
  useEffect(() => {
    if (recovery?.stage === 'failed') {
      setError(new Error(recovery.error ?? 'Recovery was not recorded.'));
    }
  }, [recovery]);
  const submit = async () => {
    setError(null);
    const recovered = await run('pass:recover', () => api.recoverPassAccount(account, controller));
    if (recovered) setDone(true);
  };
  const busy = isPending('pass:recover');
  const phase = writePhase('pass:recover');
  return <div className="mx-auto max-w-xl animate-rise"><Panel className="p-6" glow><Shield className="h-7 w-7 text-element" /><div className="eyebrow mt-4">Eternal Pass</div><h1 className="mt-2 text-2xl font-semibold">Recover the complete account</h1><p className="mt-2 text-sm leading-relaxed text-muted">Connect the pre-registered recovery controller. Recovery moves the original pass, progression, balances, escrow, orders, maturity, and limits to the new controller and disables the old one.</p>{phase === 'settling' && <p className="mt-4 border-l border-element/50 pl-3 text-sm text-element">Signature sent. The complete account is crossing to its new controllerâ€¦</p>}{error !== null && <div className="mt-4"><ErrorNote error={error} /></div>}{done ? <div className="mt-5 rounded-[3px] border border-good/30 bg-good/[0.06] p-4 text-sm">Recovery recorded. NPC selling and global rewards cool down for seven days. <Link className="text-element underline" to="/companion">Open the account</Link>.</div> : <div className="mt-5 space-y-3"><label><span className="eyebrow mb-1.5 block">Original account</span><input className={inputClass} value={account} onChange={(event) => setAccount(event.target.value)} /></label><label><span className="eyebrow mb-1.5 block">New controller</span><input className={inputClass} value={controller} onChange={(event) => setController(event.target.value)} /></label>{address ? <Button className="w-full" variant="primary" busy={busy} disabled={account.length !== 43 || controller.length !== 43} onClick={() => void submit()}>Recover account</Button> : <Button className="w-full" variant="primary" busy={connecting} onClick={connect}>Connect recovery controller</Button>}</div>}</Panel></div>;
}
