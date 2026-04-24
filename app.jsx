// =============================================================================
// LA HUNE — Draft Survey PWA
// Wrapper : écran de verrouillage + montage de l'app React.
// Le code du moteur de calcul et de l'UI est inline ci-dessous (basé sur v2).
// =============================================================================

const { useState, useMemo, useEffect } = React;

// Couleurs LA HUNE
const COLORS = {
  navy: "#1C2E5C",
  coral: "#E85B3A",
  cream: "#F8F5EF",
  ink: "#0F1A36",
  muted: "#6B7280",
  line: "#E5E0D7",
  green: "#2E7D5B",
};

const STORAGE_KEY_V = "lahune-draft-vessels-v2";
const STORAGE_KEY_C = "lahune-draft-current-v2";
const STORAGE_KEY_LOCK = "lahune-draft-lock-hash";

// --- helpers ---------------------------------------------------------------

const pf = (v) => {
  if (v === "" || v === null || v === undefined) return 0;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
};

const fmt = (n, d = 3) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toFixed(d).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
};

const lerp = (y0, y1, x0, x1, x) => {
  if (x1 - x0 === 0) return y0;
  return y0 + ((y1 - y0) / (x1 - x0)) * (x - x0);
};

const lookupHydro = (table, draft) => {
  if (!table || table.length < 2) return null;
  const sorted = [...table].sort((a, b) => a.draft - b.draft);
  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1].draft < draft) i++;
  if (i >= sorted.length - 1) i = sorted.length - 2;
  const lo = sorted[i];
  const hi = sorted[i + 1];
  return {
    disp: lerp(lo.disp, hi.disp, lo.draft, hi.draft, draft),
    tpc: lerp(lo.tpc, hi.tpc, lo.draft, hi.draft, draft),
    lcf: lerp(lo.lcf, hi.lcf, lo.draft, hi.draft, draft),
    mtc: lerp(lo.mtc, hi.mtc, lo.draft, hi.draft, draft),
    inRange: draft >= sorted[0].draft && draft <= sorted[sorted.length - 1].draft,
  };
};

const parseHydroTable = (raw) => {
  if (!raw || !raw.trim()) return [];
  const lines = raw.trim().split(/\r?\n/).filter((l) => l.trim());
  const rows = [];
  for (const line of lines) {
    const parts = line.split(/[\t,;]|\s{2,}/).map((s) => s.trim().replace(",", ".")).filter((s) => s !== "");
    if (parts.length < 4) continue;
    const nums = parts.map(parseFloat);
    if (nums.some(isNaN)) continue;
    rows.push({
      draft: nums[0], disp: nums[1], tpc: nums[2], mtc: nums[3],
      lcf: nums.length > 4 ? nums[4] : 0,
    });
  }
  return rows;
};

// Hash léger pour le verrouillage (SubtleCrypto SHA-256)
async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- moteur de calcul ------------------------------------------------------

function computeSurvey(vessel, s) {
  const LBP = pf(vessel.lbp);
  const dF = pf(vessel.distFwd);
  const dM = pf(vessel.distMid);
  const dA = pf(vessel.distAft);
  const keel = pf(vessel.keelPlate) / 1000;
  const tableDensity = pf(vessel.tableDensity) || 1.025;
  const lightship = pf(vessel.lightship);

  const fwdMean = (pf(s.fwdPort) + pf(s.fwdStbd)) / 2;
  const midMean = (pf(s.midPort) + pf(s.midStbd)) / 2;
  const aftMean = (pf(s.aftPort) + pf(s.aftStbd)) / 2;

  const LBM = LBP - dF - dA;
  const apparentTrim = aftMean - fwdMean;
  const corrFwd = LBM > 0 ? (-dF * apparentTrim) / LBM : 0;
  const corrMid = LBM > 0 ? (-dM * apparentTrim) / LBM : 0;
  const corrAft = LBM > 0 ? (+dA * apparentTrim) / LBM : 0;
  const cdFwd = fwdMean + corrFwd;
  const cdMid = midMean + corrMid;
  const cdAft = aftMean + corrAft;

  const foreAftMean = (cdFwd + cdAft) / 2;
  const meanOfMean = (foreAftMean + cdMid) / 2;
  const quarterMean = (cdFwd + cdAft + 6 * cdMid) / 8;
  const trim = cdAft - cdFwd;
  const quarterMeanMoulded = quarterMean - keel;

  const deflCm = (cdMid - foreAftMean) * 100;
  const deflType = deflCm >= 0 ? "Sag" : "Hog";
  const beam = pf(vessel.beam);
  const listDeg = beam > 0
    ? Math.atan(Math.abs(pf(s.midPort) - pf(s.midStbd)) / beam) * 180 / Math.PI
    : 0;
  const listSide = pf(s.midPort) > pf(s.midStbd) ? "Bâbord" : "Tribord";

  let disp = 0, tpc = 0, lcf = 0, mtcPlus = 0, mtcMinus = 0, diffMtc = 0, hydroSource = "";
  if (vessel.hydroMode === "table" && vessel.hydroTable && vessel.hydroTable.length >= 2) {
    const h = lookupHydro(vessel.hydroTable, quarterMeanMoulded);
    const hP = lookupHydro(vessel.hydroTable, quarterMeanMoulded + 0.5);
    const hM = lookupHydro(vessel.hydroTable, quarterMeanMoulded - 0.5);
    if (h) {
      disp = h.disp; tpc = h.tpc; lcf = h.lcf;
      mtcPlus = hP ? hP.mtc : h.mtc;
      mtcMinus = hM ? hM.mtc : h.mtc;
      diffMtc = mtcPlus - mtcMinus;
      hydroSource = `Table (${vessel.hydroTable.length} lignes)`;
    }
  } else {
    const dL = pf(s.tableDraftLower), dU = pf(s.tableDraftUpper);
    disp = lerp(pf(s.dispLower), pf(s.dispUpper), dL, dU, quarterMeanMoulded);
    tpc = lerp(pf(s.tpcLower), pf(s.tpcUpper), dL, dU, quarterMeanMoulded);
    lcf = lerp(pf(s.lcfLower), pf(s.lcfUpper), dL, dU, quarterMeanMoulded);
    mtcPlus = lerp(pf(s.mtcPlusLower), pf(s.mtcPlusUpper), dL, dU, quarterMeanMoulded);
    mtcMinus = lerp(pf(s.mtcMinusLower), pf(s.mtcMinusUpper), dL, dU, quarterMeanMoulded);
    diffMtc = mtcPlus - mtcMinus;
    hydroSource = "Interpolation 2 points";
  }

  const trimCorrA = LBP > 0 ? -(trim * 100 * tpc * lcf) / LBP : 0;
  const trimCorrB = LBP > 0 ? (trim * trim * 50 * diffMtc) / LBP : 0;
  const totalTrimCorr = trimCorrA + trimCorrB;
  const dispForTrim = disp + totalTrimCorr;
  const dockDensity = pf(s.dockDensity) || tableDensity;
  const dispCorr = tableDensity > 0 ? (dispForTrim * dockDensity) / tableDensity : 0;
  const densityCorr = dispCorr - dispForTrim;
  const deductibles = pf(s.ballast) + pf(s.freshWater) + pf(s.fuelOil) +
    pf(s.dieselOil) + pf(s.lubeOil) + pf(s.slops) + pf(s.others);
  const netDisp = dispCorr - deductibles;
  const actualConstant = netDisp - lightship;

  return {
    LBP, LBM, dF, dM, dA, keel,
    fwdMean, midMean, aftMean,
    corrFwd, corrMid, corrAft, cdFwd, cdMid, cdAft,
    foreAftMean, meanOfMean, quarterMean, quarterMeanMoulded, trim, apparentTrim,
    deflCm, deflType, listDeg, listSide,
    disp, tpc, lcf, mtcPlus, mtcMinus, diffMtc, hydroSource,
    trimCorrA, trimCorrB, totalTrimCorr,
    dispForTrim, dockDensity, tableDensity, dispCorr, densityCorr,
    deductibles, netDisp, lightship, actualConstant,
  };
}

// --- composants UI ---------------------------------------------------------

const Field = ({ label, unit, value, onChange, hint, placeholder }) => (
  <label className="block">
    <div className="flex items-baseline justify-between mb-1">
      <span className="text-[11px] uppercase tracking-wider font-medium"
        style={{ color: COLORS.navy, letterSpacing: "0.08em" }}>{label}</span>
      {unit && <span className="text-[11px]" style={{ color: COLORS.muted }}>{unit}</span>}
    </div>
    <input type="text" inputMode="decimal" value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2.5 text-base bg-white rounded-md outline-none"
      style={{
        border: `1px solid ${COLORS.line}`, color: COLORS.ink,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
      onFocus={(e) => (e.target.style.borderColor = COLORS.coral)}
      onBlur={(e) => (e.target.style.borderColor = COLORS.line)} />
    {hint && <div className="mt-1 text-[11px]" style={{ color: COLORS.muted }}>{hint}</div>}
  </label>
);

const TextField = ({ label, value, onChange, placeholder }) => (
  <label className="block">
    <div className="text-[11px] uppercase tracking-wider font-medium mb-1"
      style={{ color: COLORS.navy, letterSpacing: "0.08em" }}>{label}</div>
    <input type="text" value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2.5 text-base bg-white rounded-md outline-none"
      style={{ border: `1px solid ${COLORS.line}`, color: COLORS.ink }}
      onFocus={(e) => (e.target.style.borderColor = COLORS.coral)}
      onBlur={(e) => (e.target.style.borderColor = COLORS.line)} />
  </label>
);

const SectionTitle = ({ children, accent }) => (
  <div className="flex items-center gap-3 mb-3 mt-6">
    <div className="h-px flex-shrink-0" style={{ width: 20, backgroundColor: accent ? COLORS.coral : COLORS.navy }} />
    <h3 className="text-xs font-semibold uppercase" style={{ color: COLORS.navy, letterSpacing: "0.12em" }}>
      {children}
    </h3>
    <div className="h-px flex-1" style={{ backgroundColor: COLORS.line }} />
  </div>
);

const ResultRow = ({ label, value, unit, bold, highlight, hint }) => (
  <div className="flex items-baseline justify-between py-2 px-3 rounded"
    style={{ backgroundColor: highlight ? "#FFF4F0" : "transparent", borderBottom: highlight ? "none" : `1px dashed ${COLORS.line}` }}>
    <div className="flex flex-col">
      <span className={bold ? "text-sm font-semibold" : "text-sm"} style={{ color: highlight ? COLORS.coral : COLORS.ink }}>{label}</span>
      {hint && <span className="text-[10px]" style={{ color: COLORS.muted }}>{hint}</span>}
    </div>
    <span className={`font-mono ${bold ? "text-base font-bold" : "text-sm"}`} style={{ color: highlight ? COLORS.coral : COLORS.ink }}>
      {value} {unit && <span className="text-[11px]" style={{ color: COLORS.muted }}>{unit}</span>}
    </span>
  </div>
);

const Button = ({ onClick, children, variant = "primary", small, full }) => {
  const base = small ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  const styles = {
    primary: { backgroundColor: COLORS.coral, color: "white" },
    secondary: { backgroundColor: "white", color: COLORS.navy, border: `1px solid ${COLORS.navy}` },
    ghost: { backgroundColor: "transparent", color: COLORS.navy, border: `1px solid ${COLORS.line}` },
    danger: { backgroundColor: "white", color: "#B91C1C", border: `1px solid #FECACA` },
  };
  return (
    <button onClick={onClick} className={`${base} rounded-md font-medium uppercase tracking-wider transition-opacity hover:opacity-80 ${full ? "w-full" : ""}`}
      style={{ letterSpacing: "0.08em", ...styles[variant] }}>
      {children}
    </button>
  );
};

const SignConventionDiagram = () => (
  <svg viewBox="0 0 320 90" className="w-full" style={{ maxWidth: 320 }}>
    <defs>
      <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill={COLORS.navy} />
      </marker>
    </defs>
    <line x1="10" y1="50" x2="310" y2="50" stroke="#93C5FD" strokeWidth="1" strokeDasharray="3,2" />
    <path d="M30,50 Q30,30 60,30 L260,30 Q290,30 290,50 Z" fill="#E5E7EB" stroke={COLORS.navy} strokeWidth="1" />
    <line x1="60" y1="20" x2="60" y2="60" stroke={COLORS.navy} strokeWidth="1" />
    <line x1="160" y1="20" x2="160" y2="60" stroke={COLORS.navy} strokeWidth="0.5" strokeDasharray="2,2" />
    <line x1="260" y1="20" x2="260" y2="60" stroke={COLORS.navy} strokeWidth="1" />
    <text x="60" y="15" textAnchor="middle" fontSize="8" fill={COLORS.navy} fontWeight="bold">FP</text>
    <text x="160" y="15" textAnchor="middle" fontSize="8" fill={COLORS.navy}>midship</text>
    <text x="260" y="15" textAnchor="middle" fontSize="8" fill={COLORS.navy} fontWeight="bold">AP</text>
    <circle cx="80" cy="40" r="3" fill={COLORS.coral} />
    <circle cx="155" cy="40" r="3" fill={COLORS.coral} />
    <circle cx="240" cy="40" r="3" fill={COLORS.coral} />
    <line x1="60" y1="70" x2="80" y2="70" stroke={COLORS.coral} strokeWidth="1" markerEnd="url(#arr)" />
    <line x1="260" y1="70" x2="240" y2="70" stroke={COLORS.coral} strokeWidth="1" markerEnd="url(#arr)" />
    <text x="70" y="82" textAnchor="middle" fontSize="8" fill={COLORS.coral}>dF {'>'} 0</text>
    <text x="250" y="82" textAnchor="middle" fontSize="8" fill={COLORS.coral}>dA {'>'} 0</text>
    <text x="160" y="78" textAnchor="middle" fontSize="8" fill={COLORS.navy}>dM {'>'} 0 vers AP</text>
  </svg>
);

// --- Onglets ---------------------------------------------------------------

function VesselTab({ vessel, setVessel, profiles, onSaveProfile, onLoadProfile, onDeleteProfile }) {
  const [showTablePaste, setShowTablePaste] = useState(false);
  const [pastedTable, setPastedTable] = useState("");
  const v = (k, val) => setVessel({ ...vessel, [k]: val });

  const applyPastedTable = () => {
    const rows = parseHydroTable(pastedTable);
    if (rows.length >= 2) {
      setVessel({ ...vessel, hydroTable: rows, hydroMode: "table" });
      setShowTablePaste(false);
      setPastedTable("");
    } else {
      alert("Table non reconnue. Format : draft, displacement, TPC, MTC, LCF — séparés par tab, virgule ou espaces, une ligne par valeur.");
    }
  };

  return (
    <div className="p-4 space-y-4">
      <SectionTitle>Identification du navire</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Nom" value={vessel.name} onChange={(x) => v("name", x)} placeholder="M/V ..." />
        <TextField label="IMO" value={vessel.imo} onChange={(x) => v("imo", x)} placeholder="9xxxxxx" />
        <TextField label="Pavillon" value={vessel.flag} onChange={(x) => v("flag", x)} />
        <TextField label="Type" value={vessel.type} onChange={(x) => v("type", x)} placeholder="Bulker..." />
      </div>

      <SectionTitle>Caractéristiques</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Field label="LOA" unit="m" value={vessel.loa} onChange={(x) => v("loa", x)} />
        <Field label="LBP" unit="m" value={vessel.lbp} onChange={(x) => v("lbp", x)} />
        <Field label="Largeur (Beam)" unit="m" value={vessel.beam} onChange={(x) => v("beam", x)} />
        <Field label="Creux (Depth)" unit="m" value={vessel.depth} onChange={(x) => v("depth", x)} />
        <Field label="Lightship" unit="MT" value={vessel.lightship} onChange={(x) => v("lightship", x)} />
        <Field label="DWT été" unit="MT" value={vessel.dwt} onChange={(x) => v("dwt", x)} />
      </div>
      <Field label="Densité de la table hydrostatique" unit="t/m³" value={vessel.tableDensity}
        onChange={(x) => v("tableDensity", x)} hint="Par défaut 1,025 (eau de mer standard)" />
      <Field label="Épaisseur tôle de quille" unit="mm" value={vessel.keelPlate}
        onChange={(x) => v("keelPlate", x)} hint="Correction draft moulé → draft extrême. Laisser 0 si inconnu." />

      <SectionTitle accent>Distances des marques aux perpendiculaires</SectionTitle>
      <div className="rounded p-3 mb-2" style={{ backgroundColor: COLORS.cream }}>
        <SignConventionDiagram />
        <div className="text-[11px] mt-2" style={{ color: COLORS.muted }}>
          Convention : <strong style={{ color: COLORS.coral }}>positif</strong> si la marque est à l'intérieur du LBP.
          Pour la marque milieu, positif = aft of midship (vers AP), négatif = forward.
        </div>
      </div>
      <Field label="dF — marque avant vs FP" unit="m" value={vessel.distFwd} onChange={(x) => v("distFwd", x)} />
      <Field label="dM — marque milieu vs midship" unit="m" value={vessel.distMid} onChange={(x) => v("distMid", x)} />
      <Field label="dA — marque arrière vs AP" unit="m" value={vessel.distAft} onChange={(x) => v("distAft", x)} />

      <SectionTitle accent>Table hydrostatique</SectionTitle>
      <div className="rounded p-3" style={{ backgroundColor: COLORS.cream }}>
        <div className="text-sm font-medium mb-2" style={{ color: COLORS.navy }}>Mode de saisie</div>
        <div className="flex gap-2 mb-3">
          <button onClick={() => v("hydroMode", "manual")}
            className="flex-1 py-2 text-xs rounded transition-colors"
            style={{
              backgroundColor: vessel.hydroMode !== "table" ? COLORS.navy : "white",
              color: vessel.hydroMode !== "table" ? "white" : COLORS.navy,
              border: `1px solid ${COLORS.navy}`,
            }}>2 points (manuel)</button>
          <button onClick={() => v("hydroMode", "table")}
            className="flex-1 py-2 text-xs rounded transition-colors"
            style={{
              backgroundColor: vessel.hydroMode === "table" ? COLORS.navy : "white",
              color: vessel.hydroMode === "table" ? "white" : COLORS.navy,
              border: `1px solid ${COLORS.navy}`,
            }}>Table complète</button>
        </div>
        {vessel.hydroMode === "table" ? (
          <div>
            <div className="text-[11px] mb-2" style={{ color: COLORS.muted }}>
              {vessel.hydroTable && vessel.hydroTable.length > 0
                ? `${vessel.hydroTable.length} lignes chargées — plage ${fmt(vessel.hydroTable[0].draft, 2)} m à ${fmt(vessel.hydroTable[vessel.hydroTable.length - 1].draft, 2)} m`
                : "Aucune table chargée"}
            </div>
            {!showTablePaste ? (
              <Button onClick={() => setShowTablePaste(true)} variant="secondary" small>
                {vessel.hydroTable && vessel.hydroTable.length ? "Remplacer la table" : "Coller une table"}
              </Button>
            ) : (
              <div>
                <div className="text-[11px] mb-2" style={{ color: COLORS.muted }}>
                  Coller depuis Excel (colonnes : draft, displacement, TPC, MTC, LCF — LCF signé, + vers aft).
                </div>
                <textarea value={pastedTable} onChange={(e) => setPastedTable(e.target.value)} rows={6}
                  className="w-full p-2 text-xs rounded font-mono" style={{ border: `1px solid ${COLORS.line}` }}
                  placeholder="5.00	15432	32.1	450.2	-2.1&#10;5.10	15755	32.2	452.1	-2.0&#10;..." />
                <div className="flex gap-2 mt-2">
                  <Button onClick={applyPastedTable} small>Importer</Button>
                  <Button onClick={() => setShowTablePaste(false)} variant="ghost" small>Annuler</Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-[11px]" style={{ color: COLORS.muted }}>
            Tu entreras les deux lignes encadrantes directement dans l'onglet de chaque survey.
          </div>
        )}
      </div>

      <SectionTitle>Profils navire sauvegardés</SectionTitle>
      <div className="flex gap-2 mb-3">
        <Button onClick={onSaveProfile}>Enregistrer ce navire</Button>
      </div>
      {profiles.length === 0 ? (
        <div className="text-[11px]" style={{ color: COLORS.muted }}>Aucun profil enregistré</div>
      ) : (
        <div className="space-y-2">
          {profiles.map((p, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded"
              style={{ backgroundColor: "white", border: `1px solid ${COLORS.line}` }}>
              <div>
                <div className="text-sm font-medium" style={{ color: COLORS.ink }}>{p.name || "(sans nom)"}</div>
                <div className="text-[11px]" style={{ color: COLORS.muted }}>
                  LBP {fmt(pf(p.lbp), 2)} m · LS {fmt(pf(p.lightship), 1)} MT
                  {p.hydroTable && p.hydroTable.length ? ` · table ${p.hydroTable.length} lignes` : ""}
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => onLoadProfile(i)} variant="secondary" small>Charger</Button>
                <Button onClick={() => onDeleteProfile(i)} variant="danger" small>Suppr.</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SurveyTab({ vessel, survey, setSurvey, label, color, phase }) {
  const v = (k, val) => setSurvey({ ...survey, [k]: val });
  const r = useMemo(() => computeSurvey(vessel, survey), [vessel, survey]);
  const usingTable = vessel.hydroMode === "table" && vessel.hydroTable && vessel.hydroTable.length >= 2;

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-md p-3 flex items-center justify-between"
        style={{ backgroundColor: color, color: "white" }}>
        <span className="text-xs uppercase tracking-widest font-semibold">{label}</span>
        <span className="text-[11px] opacity-80">{phase}</span>
      </div>

      <SectionTitle>Informations du survey</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Port" value={survey.port} onChange={(x) => v("port", x)} />
        <TextField label="Date" value={survey.date} onChange={(x) => v("date", x)} placeholder="JJ/MM/AAAA" />
        <TextField label="Heure" value={survey.time} onChange={(x) => v("time", x)} />
        <TextField label="Terminal / berth" value={survey.berth} onChange={(x) => v("berth", x)} />
      </div>

      <Field label="Densité de l'eau du bassin (dock)" unit="t/m³" value={survey.dockDensity}
        onChange={(x) => v("dockDensity", x)} hint="Mesurée à l'hydromètre au niveau du navire" />

      <SectionTitle>Tirants d'eau mesurés aux marques</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Avant bâbord" unit="m" value={survey.fwdPort} onChange={(x) => v("fwdPort", x)} />
        <Field label="Avant tribord" unit="m" value={survey.fwdStbd} onChange={(x) => v("fwdStbd", x)} />
        <Field label="Milieu bâbord" unit="m" value={survey.midPort} onChange={(x) => v("midPort", x)} />
        <Field label="Milieu tribord" unit="m" value={survey.midStbd} onChange={(x) => v("midStbd", x)} />
        <Field label="Arrière bâbord" unit="m" value={survey.aftPort} onChange={(x) => v("aftPort", x)} />
        <Field label="Arrière tribord" unit="m" value={survey.aftStbd} onChange={(x) => v("aftStbd", x)} />
      </div>

      <div className="rounded p-3" style={{ backgroundColor: COLORS.cream }}>
        <div className="text-[11px] mb-2 uppercase font-semibold" style={{ color: COLORS.navy, letterSpacing: "0.1em" }}>
          Tirants corrigés et diagnostics
        </div>
        <ResultRow label="LBM (distance entre marques)" value={fmt(r.LBM, 3)} unit="m" />
        <ResultRow label="Avant corrigé" value={fmt(r.cdFwd, 4)} unit="m" />
        <ResultRow label="Milieu corrigé" value={fmt(r.cdMid, 4)} unit="m" />
        <ResultRow label="Arrière corrigé" value={fmt(r.cdAft, 4)} unit="m" />
        <ResultRow label="Assiette réelle (trim)" value={fmt(r.trim, 4)} unit="m"
          hint={r.trim > 0 ? "Sur l'arrière (by stern)" : r.trim < 0 ? "Sur l'avant (by head)" : ""} />
        <ResultRow label="Déflection" value={`${r.deflType} ${fmt(Math.abs(r.deflCm), 1)}`} unit="cm"
          hint="Diagnostic — non appliqué au calcul" />
        {r.listDeg > 0.01 && (
          <ResultRow label={`Gîte (${r.listSide})`} value={fmt(r.listDeg, 2)} unit="°"
            hint="Diagnostic — non appliqué au calcul" />
        )}
        <ResultRow label="Quarter Mean (règle 6-8)" value={fmt(r.quarterMean, 5)} unit="m" bold />
        {r.keel > 0 && (
          <ResultRow label="Quarter Mean moulé" value={fmt(r.quarterMeanMoulded, 5)} unit="m"
            hint={`− ${fmt(r.keel * 1000, 0)} mm (quille)`} />
        )}
      </div>

      <SectionTitle accent>Données hydrostatiques</SectionTitle>
      {usingTable ? (
        <div className="rounded p-3" style={{ backgroundColor: COLORS.cream }}>
          <div className="text-[11px] mb-2" style={{ color: COLORS.green, fontWeight: 500 }}>
            ✓ Interpolation automatique depuis la table ({vessel.hydroTable.length} lignes)
          </div>
          <ResultRow label="Displacement" value={fmt(r.disp, 2)} unit="MT" />
          <ResultRow label="TPC" value={fmt(r.tpc, 3)} unit="t/cm" />
          <ResultRow label="LCF" value={fmt(r.lcf, 4)} unit="m" hint="Signé depuis midship" />
          <ResultRow label="MTC à T + 0,5" value={fmt(r.mtcPlus, 3)} unit="t·m" />
          <ResultRow label="MTC à T − 0,5" value={fmt(r.mtcMinus, 3)} unit="t·m" />
          <ResultRow label="ΔMTC" value={fmt(r.diffMtc, 3)} unit="t·m" />
        </div>
      ) : (
        <div>
          <div className="rounded p-2 mb-2" style={{ backgroundColor: COLORS.cream, fontSize: 11, color: COLORS.muted }}>
            Saisir les deux lignes de la table qui encadrent le Quarter Mean ({fmt(r.quarterMeanMoulded, 3)} m).
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Draft table — bas" unit="m" value={survey.tableDraftLower} onChange={(x) => v("tableDraftLower", x)} />
            <Field label="Draft table — haut" unit="m" value={survey.tableDraftUpper} onChange={(x) => v("tableDraftUpper", x)} />
            <Field label="Displ. — bas" unit="MT" value={survey.dispLower} onChange={(x) => v("dispLower", x)} />
            <Field label="Displ. — haut" unit="MT" value={survey.dispUpper} onChange={(x) => v("dispUpper", x)} />
            <Field label="TPC — bas" unit="t/cm" value={survey.tpcLower} onChange={(x) => v("tpcLower", x)} />
            <Field label="TPC — haut" unit="t/cm" value={survey.tpcUpper} onChange={(x) => v("tpcUpper", x)} />
            <Field label="LCF — bas" unit="m" value={survey.lcfLower} onChange={(x) => v("lcfLower", x)} />
            <Field label="LCF — haut" unit="m" value={survey.lcfUpper} onChange={(x) => v("lcfUpper", x)} />
            <Field label="MTC+0,5 — bas" unit="t·m" value={survey.mtcPlusLower} onChange={(x) => v("mtcPlusLower", x)} />
            <Field label="MTC+0,5 — haut" unit="t·m" value={survey.mtcPlusUpper} onChange={(x) => v("mtcPlusUpper", x)} />
            <Field label="MTC−0,5 — bas" unit="t·m" value={survey.mtcMinusLower} onChange={(x) => v("mtcMinusLower", x)} />
            <Field label="MTC−0,5 — haut" unit="t·m" value={survey.mtcMinusUpper} onChange={(x) => v("mtcMinusUpper", x)} />
          </div>
        </div>
      )}

      <SectionTitle>Déductibles</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ballast" unit="MT" value={survey.ballast} onChange={(x) => v("ballast", x)} />
        <Field label="Fresh Water" unit="MT" value={survey.freshWater} onChange={(x) => v("freshWater", x)} />
        <Field label="Fuel Oil" unit="MT" value={survey.fuelOil} onChange={(x) => v("fuelOil", x)} />
        <Field label="Diesel Oil" unit="MT" value={survey.dieselOil} onChange={(x) => v("dieselOil", x)} />
        <Field label="Lube Oil" unit="MT" value={survey.lubeOil} onChange={(x) => v("lubeOil", x)} />
        <Field label="Slops / Sludge" unit="MT" value={survey.slops} onChange={(x) => v("slops", x)} />
        <Field label="Autres" unit="MT" value={survey.others} onChange={(x) => v("others", x)} />
      </div>

      <SectionTitle accent>Journal de calcul</SectionTitle>
      <div className="rounded p-3" style={{ backgroundColor: "white", border: `1px solid ${COLORS.line}` }}>
        <ResultRow label="① Displ. @ Quarter Mean" value={fmt(r.disp, 2)} unit="MT" />
        <ResultRow label="② 1ère corr. trim (A)" value={fmt(r.trimCorrA, 2)} unit="MT"
          hint="−Trim × TPC × LCF × 100 / LBP" />
        <ResultRow label="③ 2ème corr. trim (B)" value={fmt(r.trimCorrB, 2)} unit="MT"
          hint="Trim² × 50 × ΔMTC / LBP" />
        <ResultRow label="④ Displ. corrigé assiette (①+②+③)" value={fmt(r.dispForTrim, 2)} unit="MT" />
        <ResultRow label="⑤ Correction de densité" value={fmt(r.densityCorr, 2)} unit="MT"
          hint={`× ${fmt(r.dockDensity, 3)} / ${fmt(r.tableDensity, 3)}`} />
        <ResultRow label="⑥ Displ. corrigé (④+⑤)" value={fmt(r.dispCorr, 2)} unit="MT" bold />
        <ResultRow label="⑦ Total déductibles" value={fmt(r.deductibles, 2)} unit="MT" />
        <ResultRow label="⑧ Displ. net (⑥−⑦)" value={fmt(r.netDisp, 2)} unit="MT" highlight />
        <ResultRow label="⑨ Lightship" value={fmt(r.lightship, 2)} unit="MT" />
        <ResultRow label="⑩ Constante calculée (⑧−⑨)" value={fmt(r.actualConstant, 2)} unit="MT" bold />
      </div>
    </div>
  );
}

function ResultTab({ vessel, initial, final }) {
  const rI = useMemo(() => computeSurvey(vessel, initial), [vessel, initial]);
  const rF = useMemo(() => computeSurvey(vessel, final), [vessel, final]);
  const cargo = rF.netDisp - rI.netDisp;
  const isLoading = cargo >= 0;
  const [copied, setCopied] = useState(false);

  const report = useMemo(() => {
    const lines = [
      `DRAFT SURVEY — ${vessel.name || "(navire)"}${vessel.imo ? " (IMO " + vessel.imo + ")" : ""}`,
      `${initial.port || "?"} → ${final.port || "?"}`,
      ``,
      `NAVIRE`,
      `  LBP : ${fmt(pf(vessel.lbp), 2)} m   Lightship : ${fmt(pf(vessel.lightship), 1)} MT`,
      `  Distances aux perpendiculaires : dF=${vessel.distFwd} dM=${vessel.distMid} dA=${vessel.distAft}`,
      ``,
      `DÉPART (${initial.port || "—"}, ${initial.date || "—"})`,
      `  Tirants corrigés : F=${fmt(rI.cdFwd, 3)} M=${fmt(rI.cdMid, 3)} A=${fmt(rI.cdAft, 3)} m`,
      `  Trim : ${fmt(rI.trim, 3)} m  |  Quarter Mean : ${fmt(rI.quarterMeanMoulded, 4)} m`,
      `  Déflection : ${rI.deflType} ${fmt(Math.abs(rI.deflCm), 1)} cm  |  Dock density : ${fmt(rI.dockDensity, 3)}`,
      `  Displacement @ QM : ${fmt(rI.disp, 2)} MT`,
      `  Trim corr A : ${fmt(rI.trimCorrA, 2)}    Trim corr B : ${fmt(rI.trimCorrB, 2)} MT`,
      `  Displ. corrigé : ${fmt(rI.dispCorr, 2)} MT`,
      `  Déductibles : ${fmt(rI.deductibles, 2)} MT`,
      `  Displ. net : ${fmt(rI.netDisp, 2)} MT`,
      ``,
      `ARRIVÉE (${final.port || "—"}, ${final.date || "—"})`,
      `  Tirants corrigés : F=${fmt(rF.cdFwd, 3)} M=${fmt(rF.cdMid, 3)} A=${fmt(rF.cdAft, 3)} m`,
      `  Trim : ${fmt(rF.trim, 3)} m  |  Quarter Mean : ${fmt(rF.quarterMeanMoulded, 4)} m`,
      `  Déflection : ${rF.deflType} ${fmt(Math.abs(rF.deflCm), 1)} cm  |  Dock density : ${fmt(rF.dockDensity, 3)}`,
      `  Displacement @ QM : ${fmt(rF.disp, 2)} MT`,
      `  Trim corr A : ${fmt(rF.trimCorrA, 2)}    Trim corr B : ${fmt(rF.trimCorrB, 2)} MT`,
      `  Displ. corrigé : ${fmt(rF.dispCorr, 2)} MT`,
      `  Déductibles : ${fmt(rF.deductibles, 2)} MT`,
      `  Displ. net : ${fmt(rF.netDisp, 2)} MT`,
      ``,
      `RÉSULTAT`,
      `  Cargo ${isLoading ? "chargé" : "déchargé"} : ${fmt(Math.abs(cargo), 2)} MT`,
      ``,
      `Produit par LA HUNE — Cabinet d'expertise maritime indépendant`,
    ];
    return lines.join("\n");
  }, [vessel, initial, final, rI, rF, cargo, isLoading]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("Copie impossible — sélectionnez le texte manuellement.");
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-lg p-6 text-center" style={{ backgroundColor: COLORS.navy, color: "white" }}>
        <div className="text-[11px] uppercase tracking-widest opacity-70 mb-2">
          Quantité {isLoading ? "chargée" : "déchargée"}
        </div>
        <div className="text-4xl font-bold" style={{ color: COLORS.coral, fontFamily: "ui-monospace, monospace" }}>
          {fmt(Math.abs(cargo), 2)}
        </div>
        <div className="text-sm opacity-70 mt-1">MT</div>
      </div>

      <SectionTitle>Comparaison des deux conditions</SectionTitle>
      <div className="rounded p-3" style={{ backgroundColor: "white", border: `1px solid ${COLORS.line}` }}>
        <div className="grid grid-cols-3 gap-2 text-[11px] mb-2" style={{ color: COLORS.muted }}>
          <div></div>
          <div className="text-right font-semibold" style={{ color: COLORS.navy }}>DÉPART</div>
          <div className="text-right font-semibold" style={{ color: COLORS.coral }}>ARRIVÉE</div>
        </div>
        {[
          ["Quarter Mean", fmt(rI.quarterMeanMoulded, 4), fmt(rF.quarterMeanMoulded, 4), "m"],
          ["Trim", fmt(rI.trim, 3), fmt(rF.trim, 3), "m"],
          ["Dock density", fmt(rI.dockDensity, 3), fmt(rF.dockDensity, 3), ""],
          ["Displ. corrigé", fmt(rI.dispCorr, 2), fmt(rF.dispCorr, 2), "MT"],
          ["Déductibles", fmt(rI.deductibles, 2), fmt(rF.deductibles, 2), "MT"],
          ["Displ. net", fmt(rI.netDisp, 2), fmt(rF.netDisp, 2), "MT"],
        ].map(([label, v1, v2, unit], i) => (
          <div key={i} className="grid grid-cols-3 gap-2 py-1.5 text-sm"
            style={{ borderBottom: `1px dashed ${COLORS.line}` }}>
            <div style={{ color: COLORS.ink }}>{label}</div>
            <div className="text-right font-mono" style={{ color: COLORS.ink }}>
              {v1} <span className="text-[10px]" style={{ color: COLORS.muted }}>{unit}</span>
            </div>
            <div className="text-right font-mono" style={{ color: COLORS.ink }}>
              {v2} <span className="text-[10px]" style={{ color: COLORS.muted }}>{unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded p-3" style={{ backgroundColor: "#FFF4F0", border: `1px solid ${COLORS.coral}` }}>
        <ResultRow label={isLoading ? "Cargo chargé" : "Cargo déchargé"}
          value={fmt(Math.abs(cargo), 2)} unit="MT" bold highlight />
      </div>

      <SectionTitle>Exporter</SectionTitle>
      <Button onClick={copy}>{copied ? "✓ Copié" : "Copier le rapport dans le presse-papier"}</Button>

      <details className="rounded" style={{ backgroundColor: "white", border: `1px solid ${COLORS.line}` }}>
        <summary className="p-3 text-sm cursor-pointer font-medium" style={{ color: COLORS.navy }}>
          Aperçu du rapport
        </summary>
        <pre className="p-3 text-[11px] overflow-x-auto font-mono whitespace-pre-wrap"
          style={{ color: COLORS.ink, borderTop: `1px solid ${COLORS.line}` }}>{report}</pre>
      </details>

      <div className="text-[11px] mt-4" style={{ color: COLORS.muted }}>
        Cet outil est un <strong>prototype</strong> pour vérification en stage. Les valeurs ne se substituent pas
        aux calculs manuels du surveyeur, qui restent seuls à engager la responsabilité professionnelle.
      </div>
    </div>
  );
}

// --- Écran de verrouillage -------------------------------------------------

function LockScreen({ onUnlock }) {
  const [mode, setMode] = useState(null); // null = checking, "setup" | "unlock"
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const existing = localStorage.getItem(STORAGE_KEY_LOCK);
    setMode(existing ? "unlock" : "setup");
  }, []);

  const handleSetup = async () => {
    if (password.length < 4) return setError("Mot de passe trop court (4 caractères minimum)");
    if (password !== confirm) return setError("Les mots de passe ne correspondent pas");
    const hash = await sha256(password);
    localStorage.setItem(STORAGE_KEY_LOCK, hash);
    onUnlock();
  };

  const handleUnlock = async () => {
    const hash = await sha256(password);
    if (hash === localStorage.getItem(STORAGE_KEY_LOCK)) {
      onUnlock();
    } else {
      setError("Mot de passe incorrect");
      setPassword("");
    }
  };

  const handleReset = () => {
    if (!confirm("Réinitialiser complètement l'app ? Toutes les données locales (profils, survey en cours) seront effacées.")) return;
    localStorage.clear();
    setMode("setup");
    setPassword(""); setConfirm(""); setError("");
  };

  if (mode === null) return null;

  return (
    <div style={{ minHeight: "100dvh", backgroundColor: COLORS.navy, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ maxWidth: 360, width: "100%" }}>
        <div style={{ color: "white", textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.3em", opacity: 0.7, marginBottom: 4 }}>LA&nbsp;HUNE.</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>Draft Survey</div>
        </div>
        <div style={{ backgroundColor: "white", borderRadius: 8, padding: 20 }}>
          {mode === "setup" ? (
            <div>
              <div style={{ fontSize: 13, color: COLORS.navy, fontWeight: 600, marginBottom: 4 }}>
                Première utilisation
              </div>
              <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 16 }}>
                Définissez un mot de passe pour verrouiller l'accès à l'application sur ce téléphone.
              </div>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Mot de passe" autoComplete="new-password"
                onKeyDown={(e) => e.key === "Enter" && handleSetup()}
                className="w-full px-3 py-2.5 text-base rounded mb-2"
                style={{ border: `1px solid ${COLORS.line}` }} />
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirmation" autoComplete="new-password"
                onKeyDown={(e) => e.key === "Enter" && handleSetup()}
                className="w-full px-3 py-2.5 text-base rounded mb-2"
                style={{ border: `1px solid ${COLORS.line}` }} />
              {error && <div style={{ color: "#B91C1C", fontSize: 12, marginBottom: 8 }}>{error}</div>}
              <Button onClick={handleSetup} full>Définir le mot de passe</Button>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 13, color: COLORS.navy, fontWeight: 600, marginBottom: 16 }}>
                Déverrouiller
              </div>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Mot de passe" autoComplete="current-password" autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
                className="w-full px-3 py-2.5 text-base rounded mb-2"
                style={{ border: `1px solid ${COLORS.line}` }} />
              {error && <div style={{ color: "#B91C1C", fontSize: 12, marginBottom: 8 }}>{error}</div>}
              <Button onClick={handleUnlock} full>Déverrouiller</Button>
              <button onClick={handleReset}
                style={{ marginTop: 16, width: "100%", fontSize: 11, color: COLORS.muted, textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }}>
                Mot de passe oublié — réinitialiser
              </button>
            </div>
          )}
        </div>
        <div style={{ color: "white", opacity: 0.5, fontSize: 10, textAlign: "center", marginTop: 16, letterSpacing: "0.08em" }}>
          Verrouillage local — n'assure pas une sécurité cryptographique forte.
        </div>
      </div>
    </div>
  );
}

// --- App principale --------------------------------------------------------

const emptyVessel = {
  name: "", imo: "", flag: "", type: "",
  loa: "", lbp: "", beam: "", depth: "", lightship: "", dwt: "",
  tableDensity: "1.025", keelPlate: "0",
  distFwd: "", distMid: "", distAft: "",
  hydroMode: "manual",
  hydroTable: [],
};

const emptySurvey = {
  port: "", date: "", time: "", berth: "",
  dockDensity: "",
  fwdPort: "", fwdStbd: "",
  midPort: "", midStbd: "",
  aftPort: "", aftStbd: "",
  tableDraftLower: "", tableDraftUpper: "",
  dispLower: "", dispUpper: "",
  tpcLower: "", tpcUpper: "",
  lcfLower: "", lcfUpper: "",
  mtcPlusLower: "", mtcPlusUpper: "",
  mtcMinusLower: "", mtcMinusUpper: "",
  ballast: "", freshWater: "", fuelOil: "", dieselOil: "",
  lubeOil: "", slops: "", others: "",
};

function DraftSurveyApp() {
  const [tab, setTab] = useState("vessel");

  const [vessel, setVessel] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_C);
      if (saved) return { ...emptyVessel, ...JSON.parse(saved).vessel };
    } catch {}
    return emptyVessel;
  });
  const [initial, setInitial] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_C);
      if (saved) return { ...emptySurvey, ...JSON.parse(saved).initial };
    } catch {}
    return emptySurvey;
  });
  const [final, setFinal] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_C);
      if (saved) return { ...emptySurvey, ...JSON.parse(saved).final };
    } catch {}
    return emptySurvey;
  });
  const [profiles, setProfiles] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_V);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_C, JSON.stringify({ vessel, initial, final }));
    } catch {}
  }, [vessel, initial, final]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_V, JSON.stringify(profiles));
    } catch {}
  }, [profiles]);

  const onSaveProfile = () => {
    if (!vessel.name) {
      alert("Donnez un nom au navire avant de l'enregistrer.");
      return;
    }
    const idx = profiles.findIndex((p) => p.name === vessel.name);
    if (idx >= 0) {
      if (!confirm(`Un profil "${vessel.name}" existe déjà. L'écraser ?`)) return;
      const next = [...profiles];
      next[idx] = { ...vessel };
      setProfiles(next);
    } else {
      setProfiles([...profiles, { ...vessel }]);
    }
  };
  const onLoadProfile = (i) => setVessel({ ...profiles[i] });
  const onDeleteProfile = (i) => {
    if (!confirm(`Supprimer le profil "${profiles[i].name}" ?`)) return;
    setProfiles(profiles.filter((_, j) => j !== i));
  };

  const resetAll = () => {
    if (!confirm("Réinitialiser tous les champs (navire, départ, arrivée) ? Les profils sauvegardés ne seront pas touchés.")) return;
    setVessel(emptyVessel);
    setInitial(emptySurvey);
    setFinal(emptySurvey);
  };

  const lock = () => {
    if (!confirm("Verrouiller l'application ?")) return;
    window.location.reload();
  };

  const tabs = [
    { id: "vessel", label: "Navire" },
    { id: "initial", label: "Départ" },
    { id: "final", label: "Arrivée" },
    { id: "result", label: "Résultat" },
  ];

  return (
    <div className="min-h-screen w-full"
      style={{ backgroundColor: COLORS.cream, fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      <header className="px-4 py-3 sticky top-0 z-10"
        style={{ backgroundColor: COLORS.navy, color: "white" }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] opacity-70">LA&nbsp;HUNE.</div>
            <div className="text-lg font-semibold mt-0.5">Draft Survey <span className="text-[10px] font-normal opacity-60">v2</span></div>
          </div>
          <div className="flex gap-3">
            <button onClick={resetAll}
              className="text-[10px] uppercase tracking-wider opacity-60 hover:opacity-100"
              style={{ letterSpacing: "0.1em" }}>Réinit.</button>
            <button onClick={lock}
              className="text-[10px] uppercase tracking-wider opacity-60 hover:opacity-100"
              style={{ letterSpacing: "0.1em" }}>Verrou</button>
          </div>
        </div>
      </header>

      <nav className="flex sticky z-10"
        style={{ top: 60, backgroundColor: "white", borderBottom: `1px solid ${COLORS.line}` }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex-1 py-3 text-xs uppercase tracking-wider font-semibold transition-colors"
              style={{
                color: active ? COLORS.coral : COLORS.muted,
                borderBottom: `2px solid ${active ? COLORS.coral : "transparent"}`,
              }}>
              {t.label}
            </button>
          );
        })}
      </nav>

      <main className="max-w-2xl mx-auto pb-16">
        {tab === "vessel" && (
          <VesselTab vessel={vessel} setVessel={setVessel} profiles={profiles}
            onSaveProfile={onSaveProfile} onLoadProfile={onLoadProfile} onDeleteProfile={onDeleteProfile} />
        )}
        {tab === "initial" && (
          <SurveyTab vessel={vessel} survey={initial} setSurvey={setInitial}
            label="Condition de départ (initial)" color={COLORS.navy} phase="Initial Survey" />
        )}
        {tab === "final" && (
          <SurveyTab vessel={vessel} survey={final} setSurvey={setFinal}
            label="Condition d'arrivée (final)" color={COLORS.coral} phase="Final Survey" />
        )}
        {tab === "result" && <ResultTab vessel={vessel} initial={initial} final={final} />}
      </main>
    </div>
  );
}

// --- Racine : lock → app ---------------------------------------------------

function Root() {
  const [unlocked, setUnlocked] = useState(false);
  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;
  return <DraftSurveyApp />;
}

ReactDOM.createRoot(document.getElementById("root")).render(<Root />);
