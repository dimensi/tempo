import 'server-only';

export const reportStyles = `
@page{size:A4 portrait;margin:0}
:root{--paper:#F8F7F2;--ink:#202C28;--muted:#55645D;--brand:#225C45;--rule:#D4DAD1;--wash:#E8EDE4;--calories:#B45309;--protein:#2874B5;--fat:#946500;--carbs:#23784B;--breakfast:#B45309;--lunch:#2874B5;--dinner:#7956AA;--snack:#258879}
*{box-sizing:border-box;animation:none!important;transition:none!important}
html,body{margin:0;padding:0}
body{font-family:'Report Sans',sans-serif;font-size:10pt;line-height:1.42;color:var(--ink);print-color-adjust:exact;-webkit-print-color-adjust:exact}
.report-page{position:relative;width:210mm;height:297mm;background:var(--paper);break-inside:avoid}
.report-page:not(:last-child){break-after:page}
.page-header{position:absolute;top:9mm;left:14.8mm;right:14.8mm;height:8mm;border-bottom:.25mm solid var(--rule);display:flex;justify-content:space-between;align-items:flex-start;font-size:8pt;color:var(--muted)}
.page-header strong{color:var(--brand)}
.page-body{position:absolute;left:14.8mm;top:25mm;width:180.4mm;height:247mm;display:flow-root}
.page-footer{position:absolute;top:280mm;left:14.8mm;right:14.8mm;height:10mm;padding-top:3mm;border-top:.25mm solid var(--rule);display:flex;justify-content:space-between;font-size:8pt;color:var(--muted)}
#report-source{width:180.4mm}
h1,h2,h3,p,figure{margin:0}
h1{font-family:'Report Serif',serif;font-weight:400;font-size:30pt;line-height:1.12;overflow-wrap:anywhere}
.intro{padding-bottom:6mm;border-bottom:.25mm solid var(--brand);margin-bottom:5mm}
.subtitle{margin-top:3mm;font-size:9pt;color:var(--muted)}
.section-title,h2{font-size:14pt;line-height:1.2;font-weight:700}
.summary-block{margin-bottom:5mm;break-inside:avoid}
.section-title-row{display:flex;justify-content:space-between;align-items:center;gap:4mm;margin-bottom:2mm}
.share-caption{max-width:34mm;text-align:right;font-size:7.5pt;color:var(--muted)}
.summary-row{display:grid;grid-template-columns:minmax(0,1fr) max-content 12mm 28mm;gap:4mm;align-items:baseline;min-height:13mm;padding:2.4mm 0;border-bottom:.25mm solid var(--rule)}
.summary-value{font-size:16pt;font-weight:700;line-height:1.12;text-align:right}
.summary-row[data-nutrient=calories] .summary-value{font-size:22pt}
.summary-unit{font-size:9pt;color:var(--muted)}
.energy-share{text-align:right;font-size:12pt;font-weight:700}
.numeric{font-variant-numeric:tabular-nums lining-nums;white-space:nowrap}
[data-nutrient=calories] .number,[data-nutrient=calories].number{color:var(--calories)}
[data-nutrient=protein] .number,[data-nutrient=protein].number{color:var(--protein)}
[data-nutrient=fat] .number,[data-nutrient=fat].number{color:var(--fat)}
[data-nutrient=carbs] .number,[data-nutrient=carbs].number{color:var(--carbs)}
.partial{grid-column:1/-1;font-size:8pt;color:var(--muted);white-space:normal}
.bar{width:100%;display:flex;height:4.6mm;margin-top:3mm}
.macro-bar{height:5.6mm;margin:2mm 0 1mm}
.segment{min-width:0;height:100%}
.segment[data-nutrient=protein]{background:var(--protein)}
.segment[data-nutrient=fat]{background:var(--fat)}
.segment[data-nutrient=carbs]{background:var(--carbs)}
.meal-marker{display:inline-block;width:2.3mm;height:2.3mm;margin-right:3mm;background:currentColor}
.small-note{font-size:8pt;color:var(--muted);margin-top:3mm}
[data-meal=breakfast]{--meal-color:var(--breakfast)}
[data-meal=lunch]{--meal-color:var(--lunch)}
[data-meal=dinner]{--meal-color:var(--dinner)}
[data-meal=snack]{--meal-color:var(--snack)}
.segment[data-meal]{background:var(--meal-color)}
.meal-summary-row{display:grid;grid-template-columns:42mm 14mm repeat(4,minmax(0,1fr));gap:2mm;align-items:center;min-height:12.7mm;border-bottom:.25mm solid var(--rule)}
.meal-summary-row>*{min-width:0}
.meal-summary-row .number,.meal-summary-row .meal-share{text-align:right}
.meal-summary-name{font-size:10pt;font-weight:700}
.meal-marker{color:var(--meal-color)}
.meal-share{font-size:8pt;color:var(--muted)}
.meal-summary-head{min-height:8mm;font-size:8pt;font-weight:700}
.explanation{background:var(--wash);padding:4mm;font-size:8.5pt;line-height:1.45}
.explanation strong{display:block;margin-bottom:2mm;font-size:10pt;color:var(--brand)}
.source-updated{font-size:8pt;color:var(--muted);margin-top:3mm}
.details-intro{margin-bottom:8mm}
.details-intro h1{font-size:26pt}
.meal-block{margin-bottom:9mm;padding-bottom:7mm;border-bottom:.25mm solid var(--rule)}
.meal-heading{display:flex;justify-content:space-between;align-items:center;gap:5mm;background:var(--wash);min-height:13mm;padding:2.5mm 4mm;margin-bottom:6mm}
.meal-heading h2{color:var(--meal-color);font-size:14pt;flex:1;min-width:0}
.meal-heading .meal-calories{font-size:13pt;font-weight:700;color:var(--calories);white-space:nowrap}
.meal-body--with-photo{display:grid;grid-template-columns:60.3mm minmax(0,1fr);gap:8.5mm;align-items:start}
.meal-photo{width:60.3mm;max-width:100%;margin:0}
.meal-photo img{display:block;max-width:100%;max-height:85mm;width:auto;height:auto;object-fit:contain;image-orientation:from-image}
.entries{min-width:0}
.entry{break-inside:avoid;min-width:0}
.entry+.entry{border-top:.25mm solid var(--rule);margin-top:6mm;padding-top:6mm}
.entry-name{font-size:11pt;line-height:15pt;overflow-wrap:anywhere}
.entry-meta{font-size:8pt;line-height:11pt;color:var(--muted);margin-top:2mm;overflow-wrap:anywhere}
.nutrients{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:3mm;margin-top:4mm}
.nutrient-label{font-size:7.5pt;color:var(--muted)}
.nutrient-value{font-size:11pt;font-weight:700;margin-top:1mm}
.entry-issues{font-size:8pt;color:var(--muted);margin-top:2mm}
.fallback-photo{margin-bottom:6mm}
.notes{border-top:.25mm solid var(--brand);padding-top:4mm;font-size:8pt;color:var(--muted);break-inside:avoid}
.notes h2{font-size:10pt;color:var(--ink);margin-bottom:3mm}
.empty{font-size:10pt;color:var(--muted)}
@media screen{body{background:#e8e8e2}#report-pages{width:max-content;margin:0 auto}.report-page{margin:0 auto 6mm}}
@media print{body,#report-pages{width:210mm}.report-page{margin:0}}
`;
