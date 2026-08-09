import { describe, expect, it } from 'vitest';
import { analyzeCodeBlock, extractConfigBlock, extractRefs } from '@/lib/agents/analysis/dataform';

const at = (content: string, language: string | null = 'sqlx') => ({ language, content, line: 10 });
const regole = (content: string, language: string | null = 'sqlx') =>
  analyzeCodeBlock(at(content, language)).map((f) => f.rule);

describe('estrazione del blocco config', () => {
  it('gestisce le graffe annidate', () => {
    const config = extractConfigBlock(
      'config {\n  type: "incremental",\n  bigquery: { partitionBy: "data" }\n}\nselect 1',
    );
    expect(config).toContain('type: "incremental"');
    expect(config).toContain('partitionBy');
  });

  it('restituisce null se il blocco non c’è', () => {
    expect(extractConfigBlock('select * from tabella')).toBeNull();
  });
});

describe('estrazione delle dipendenze', () => {
  it('riconosce ref() a uno e due argomenti', () => {
    const refs = extractRefs('select * from ${ref("eventi")} join ${ref("analytics", "utenti")}');
    expect(refs).toContain('eventi');
    expect(refs).toContain('utenti');
  });

  it('non duplica lo stesso riferimento', () => {
    expect(extractRefs('${ref("a")} ${ref("a")}')).toEqual(['a']);
  });
});

describe('regole su tabelle incrementali', () => {
  it('segnala una tabella incrementale senza condizione', () => {
    const trovate = regole(`config { type: "incremental", uniqueKey: ["id"] }
select data, count(*) from \${ref("eventi")} group by data`);

    expect(trovate).toContain('incrementale-senza-condizione');
  });

  it('non segnala nulla quando la condizione c’è', () => {
    const trovate = regole(`config { type: "incremental", uniqueKey: ["id"], bigquery: { partitionBy: "data" } }
select data, count(*) from \${ref("eventi")}
\${when(incremental(), \`where data > (select max(data) from \${self()})\`)}
group by data`);

    expect(trovate).not.toContain('incrementale-senza-condizione');
  });

  it('segnala l’assenza di uniqueKey', () => {
    const trovate = regole(`config { type: "incremental" }
select * from \${ref("eventi")} where data > (select max(data) from \${self()})`);

    expect(trovate).toContain('incrementale-senza-unique-key');
  });

  it('segnala l’assenza di partizionamento', () => {
    const trovate = regole(`config { type: "incremental", uniqueKey: ["id"] }
select 1 from \${ref("eventi")} where x > (select max(x) from \${self()})`);

    expect(trovate).toContain('incrementale-senza-partizionamento');
  });
});

describe('altre regole SQL', () => {
  it('segnala SELECT *', () => {
    expect(regole('config { type: "table" }\nselect * from ${ref("eventi")}')).toContain(
      'select-asterisco',
    );
  });

  it('segnala una tabella indicata senza ref()', () => {
    expect(regole('config { type: "table" }\nselect a from `progetto.dataset.eventi`')).toContain(
      'riferimento-non-dichiarato',
    );
  });

  it('non segnala la tabella fisica in una dichiarazione', () => {
    expect(
      regole('config { type: "declaration" }\nselect * from `progetto.dataset.eventi`'),
    ).not.toContain('riferimento-non-dichiarato');
  });

  it('segnala DELETE senza WHERE come critico', () => {
    const trovate = analyzeCodeBlock(at('delete from analytics.eventi', 'sql'));
    const critica = trovate.find((f) => f.rule === 'delete-senza-where');
    expect(critica?.severity).toBe('critical');
  });

  it('segnala un blocco SQLX senza config', () => {
    expect(regole('select 1')).toContain('sqlx-senza-config');
  });

  it('segnala un blocco senza linguaggio dichiarato', () => {
    expect(regole('select 1', null)).toContain('blocco-senza-linguaggio');
  });
});

describe('regole JavaScript', () => {
  it('segnala var e confronto debole', () => {
    const trovate = regole('var x = 1;\nif (x == "1") { }', 'javascript');
    expect(trovate).toContain('var-obsoleto');
    expect(trovate).toContain('confronto-debole');
  });

  it('non segnala il confronto stretto', () => {
    expect(regole('const x = 1;\nif (x === 1) { }', 'javascript')).not.toContain('confronto-debole');
  });
});
