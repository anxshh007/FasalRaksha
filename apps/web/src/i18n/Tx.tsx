/**
 * A translated sentence whose inserted values are figures: the words stay in the interface face
 * (Noto for Marathi), and only the values are set in DM Mono with tabular digits (§9.5). Setting
 * a whole Marathi sentence in a monospace face spaces every word apart.
 */
import { Fragment } from 'react';

import { raw, type Locale, type StringKey } from './strings';

export function Tx({ locale, k, values, className }: { locale: Locale; k: StringKey; values: Record<string, string | number>; className?: string }) {
  const parts = raw(locale, k).split(/(\{\w+\})/g);
  return (
    <span className={className}>
      {parts.map((part, i) => {
        const name = /^\{(\w+)\}$/.exec(part)?.[1];
        if (name === undefined) return <Fragment key={i}>{part}</Fragment>;
        return (
          <span key={i} className="figure">
            {String(values[name] ?? part)}
          </span>
        );
      })}
    </span>
  );
}
