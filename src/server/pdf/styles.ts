import 'server-only';

export const reportStyles = `
@page{size:A4 portrait;margin:0}
:root{--paper:#F8F7F2;--ink:#202C28;--muted:#55645D;--brand:#225C45;--rule:#D4DAD1;--wash:#E8EDE4;--calories:#B45309;--protein:#236AA8;--fat:#946500;--carbs:#23784B;--breakfast:#B45309;--lunch:#236AA8;--dinner:#7956AA;--snack:#1D7468;--numeric-columns:18.5mm 17mm 17mm 19mm}
*{box-sizing:border-box;animation:none!important;transition:none!important}
html,body{margin:0;padding:0}
body{font-family:'Report Sans',sans-serif;font-size:10pt;line-height:1.32;color:var(--ink);print-color-adjust:exact;-webkit-print-color-adjust:exact}
.report-page{position:relative;width:210mm;height:297mm;background:var(--paper);break-inside:avoid}
.report-page:not(:last-child){break-after:page}
.page-header{position:absolute;top:10mm;left:11.3mm;right:11.3mm;min-height:10mm;border-bottom:.25mm solid var(--brand);display:flex;justify-content:space-between;align-items:baseline;gap:6mm;padding-bottom:2mm}
.page-header h1{font-family:'Report Serif',serif;font-size:20pt;line-height:1.15;font-weight:400}
.page-header .header-date{font-size:9pt;color:var(--muted);text-align:right}
.page-body{position:absolute;left:11.3mm;top:24mm;width:187.4mm;height:252mm;display:flow-root}
.page-footer{position:absolute;top:282mm;left:11.3mm;right:11.3mm;height:9mm;padding-top:2mm;border-top:.25mm solid var(--rule);display:flex;justify-content:space-between;font-size:7.5pt;color:var(--muted)}
#report-source{width:187.4mm}
h1,h2,h3,p,figure{margin:0}
h2{font-size:11pt;line-height:1.2;font-weight:700}
.counts{font-size:8pt;color:var(--muted);margin-bottom:3mm}
.summary-block{margin-bottom:3mm;break-inside:avoid}
.daily-totals{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4mm;padding:2mm 0 3mm;border-bottom:.25mm solid var(--rule)}
.total-column{min-width:0}
.total-label{font-size:8pt;margin-bottom:1.2mm;color:var(--muted)}
.summary-value{display:block;font-size:16pt;font-weight:700;line-height:1.15}
.total-column[data-nutrient=calories] .summary-value{font-size:18pt}
.summary-unit{font-size:9pt;font-weight:400}
.total-caption{font-size:8pt;color:var(--muted);margin-top:1.5mm}
.energy-share{font-size:9pt;font-weight:700}
.numeric{font-variant-numeric:tabular-nums lining-nums;white-space:nowrap}
[data-nutrient=calories] .number,[data-nutrient=calories].number{color:var(--calories)}
[data-nutrient=protein] .number,[data-nutrient=protein].number{color:var(--protein)}
[data-nutrient=fat] .number,[data-nutrient=fat].number{color:var(--fat)}
[data-nutrient=carbs] .number,[data-nutrient=carbs].number{color:var(--carbs)}
.partial{font-size:7.5pt;color:var(--muted);margin-top:1mm;white-space:normal}
.charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4mm;margin:3mm 0}
.chart{min-width:0}
.chart h2{font-size:9pt;margin-bottom:1.5mm}
.bar{width:100%;display:flex;height:3.2mm}
.segment{min-width:0;height:100%}
.segment[data-nutrient=protein]{background:var(--protein)}
.segment[data-nutrient=fat]{background:var(--fat)}
.segment[data-nutrient=carbs]{background:var(--carbs)}
[data-meal=breakfast]{--meal-color:var(--breakfast)}
[data-meal=lunch]{--meal-color:var(--lunch)}
[data-meal=dinner]{--meal-color:var(--dinner)}
[data-meal=snack]{--meal-color:var(--snack)}
.segment[data-meal]{background:var(--meal-color)}
.legend{display:flex;justify-content:space-between;gap:2mm;margin-top:1.5mm;font-size:7.5pt;line-height:1.35}
.legend--meals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5mm 2mm}
.legend-item{min-width:0;white-space:nowrap}
.marker{display:inline-block;width:1.6mm;height:1.6mm;margin-right:1.2mm;background:currentColor}
.legend-item[data-nutrient=protein]{color:var(--protein)}
.legend-item[data-nutrient=fat]{color:var(--fat)}
.legend-item[data-nutrient=carbs]{color:var(--carbs)}
.legend-item[data-meal]{color:var(--meal-color)}
.small-note{font-size:7.5pt;color:var(--muted);margin-top:1.5mm}
.table-header,.meal-heading{display:grid;grid-template-columns:33.5mm minmax(0,1fr) var(--numeric-columns);column-gap:2.5mm;align-items:baseline}
.table-header{font-size:8pt;color:var(--muted);padding:1mm 0 1.5mm}
.table-header .heading-space{grid-column:1/3}
.table-header span:not(.heading-space){text-align:right;white-space:nowrap}
.meal-block{margin-bottom:3mm;break-inside:avoid}
.meal-heading{background:var(--wash);min-height:8.5mm;padding:2mm 0;margin-bottom:2mm}
.meal-heading h2{grid-column:1/3;color:var(--meal-color);padding-left:2mm;overflow-wrap:anywhere}
.meal-heading .meal-total{font-size:9.5pt;line-height:13.2pt;font-weight:700;text-align:right;min-width:0}
.meal-body{display:grid;grid-template-columns:31.75mm minmax(0,1fr);column-gap:4.25mm;align-items:start}
.meal-media{min-width:0;margin:0}
.meal-media img{display:block;width:31.75mm;height:31.75mm;object-fit:cover;object-position:center;image-orientation:from-image}
.meal-entries{min-width:0;grid-column:2}
.entry{display:grid;grid-template-columns:minmax(0,1fr) var(--numeric-columns);column-gap:2.5mm;align-items:start;break-inside:avoid;min-width:0}
.entry+.entry{border-top:.25mm solid var(--rule);margin-top:2mm;padding-top:2mm}
.entry-info{min-width:0}
.entry-name{font-size:10pt;line-height:13.2pt;overflow-wrap:anywhere}
.entry-meta{font-size:7.5pt;line-height:10pt;color:var(--muted);margin-top:.7mm;overflow-wrap:anywhere}
.nutrient-value{font-size:9.5pt;line-height:13.2pt;text-align:right;min-width:0}
.entry-issues{font-size:7.5pt;color:var(--muted);margin-top:.7mm}
.notes{border-top:.25mm solid var(--rule);padding-top:2mm;margin-top:1mm;font-size:7.5pt;line-height:1.35;color:var(--muted);break-inside:avoid}
.notes p+p{margin-top:1mm}
.empty{font-size:8pt;color:var(--muted);margin-bottom:2mm}
@media screen{body{background:#e8e8e2}#report-pages{width:max-content;margin:0 auto}.report-page{margin:0 auto 6mm}}
.report-preview #report-source{width:210mm;padding:6mm 11.3mm;margin:0 auto;background:var(--paper)}
.report-preview .day-source+.day-source{border-top:.25mm solid var(--brand);margin-top:6mm;padding-top:6mm}
.preview-header{display:flex;justify-content:space-between;align-items:baseline;gap:6mm;border-bottom:.25mm solid var(--brand);padding-bottom:2mm;margin-bottom:3mm}
.preview-header h1{font-family:'Report Serif',serif;font-size:20pt;line-height:1.15;font-weight:400}
.preview-header span{font-size:9pt;color:var(--muted);text-align:right}
@media print{body,#report-pages{width:210mm}.report-page{margin:0}}
`;
