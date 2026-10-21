// Excel (.xlsx) download for Reports, written by hand so the site needs no extra library.
// Takes the same report the CSV uses — {title, about, details:[[label,value]], sections:[{heading, columns, rows, totals,
// filter}], notes, sheet} — and lays it out with a clear hierarchy: shop name and report title, a bordered details block,
// plum section bars, lilac column headers, bordered cells, a blush totals row, and colour on what matters (statuses,
// balances still owed, rises and drops). Dates and pesos stay real numbers, so sorting, filtering and sums still work.

const PLUM='5C3D6E',LILAC='E8DFF5',BLUSH='F5D9E8',LINE='D9D0E8',INK='2E2238',MUTED='7A5D8A';
const TONES={good:['E3F4E8','1E6B3A'],wait:['FFF4D6','8A5A00'],bad:['FCE4E4','9B1C1C'],busy:['E6EAFB','34419A']};
const FORMATS={money:'"₱"#,##0.00',date:'mmm d, yyyy',pct:'0"%";-0"%";0"%"',int:'#,##0',order:'"#"0'};

const esc=s=>String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const colName=i=>{let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};
const serial=iso=>(Date.UTC(+iso.slice(0,4),+iso.slice(5,7)-1,+iso.slice(8,10))-Date.UTC(1899,11,30))/86400000;

// status words → colour
function tone(text){
 const s=String(text).toLowerCase();
 if(/cancel|reject/.test(s))return 'bad';
 if(/partial/.test(s))return 'busy';
 if(/^(paid|completed|verified)$/.test(s))return 'good';
 if(/pending|unpaid|awaiting|verification/.test(s))return 'wait';
 if(/confirmed|preparing|ready/.test(s))return 'busy';
 return '';
}

// ---- styles: fonts, fills and borders are collected as they are used, then written to styles.xml
function styleBook(){
 const fonts=['<font><sz val="11"/><color rgb="FF'+INK+'"/><name val="Calibri"/><family val="2"/></font>'],fills=['<fill><patternFill patternType="none"/></fill>','<fill><patternFill patternType="gray125"/></fill>'],borders=['<border><left/><right/><top/><bottom/><diagonal/></border>'],xfs=['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
 const numFmts=Object.values(FORMATS),seen=new Map();
 const add=(list,xml)=>{let i=list.indexOf(xml);if(i<0){list.push(xml);i=list.length-1;}return i;};
 const font=({bold,italic,size=11,color=INK})=>add(fonts,'<font>'+(bold?'<b/>':'')+(italic?'<i/>':'')+'<sz val="'+size+'"/><color rgb="FF'+color+'"/><name val="Calibri"/><family val="2"/></font>');
 const fill=color=>color?add(fills,'<fill><patternFill patternType="solid"><fgColor rgb="FF'+color+'"/><bgColor indexed="64"/></patternFill></fill>'):0;
 const side=(name,kind,color)=>kind?'<'+name+' style="'+kind+'"><color rgb="FF'+color+'"/></'+name+'>':'<'+name+'/>';
 const border=b=>b?add(borders,'<border>'+side('left','thin',LINE)+side('right','thin',LINE)+(b==='total'?side('top','medium',PLUM)+side('bottom','medium',PLUM):b==='head'?side('top','thin',PLUM)+side('bottom','medium',PLUM):side('top','thin',LINE)+side('bottom','thin',LINE))+'<diagonal/></border>'):0;
 // one cell look → xf index
 function xf(look){
  const key=JSON.stringify(look);if(seen.has(key))return seen.get(key);
  const fmt=look.format?164+numFmts.indexOf(FORMATS[look.format]):0;
  const align=look.h||look.wrap||look.v?'<alignment'+(look.h?' horizontal="'+look.h+'"':'')+' vertical="'+(look.v||'center')+'"'+(look.wrap?' wrapText="1"':'')+'/>':'<alignment vertical="center"/>';
  xfs.push('<xf numFmtId="'+fmt+'" fontId="'+font(look)+'" fillId="'+fill(look.fill)+'" borderId="'+border(look.border)+'" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">'+align+'</xf>');
  seen.set(key,xfs.length-1);return xfs.length-1;
 }
 const xml=()=>'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
  '<numFmts count="'+numFmts.length+'">'+numFmts.map((f,i)=>'<numFmt numFmtId="'+(164+i)+'" formatCode="'+esc(f)+'"/>').join('')+'</numFmts>'+
  '<fonts count="'+fonts.length+'">'+fonts.join('')+'</fonts><fills count="'+fills.length+'">'+fills.join('')+'</fills><borders count="'+borders.length+'">'+borders.join('')+'</borders>'+
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="'+xfs.length+'">'+xfs.join('')+'</cellXfs>'+
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
 return {xf,xml};
}

// what kind of value a table cell holds, judged from its column header (and, in the summary, its row label)
function kindOf(value,header,label){
 if(value&&typeof value==='object'&&'text' in value)return {kind:'text',value:value.text};
 if(value===''||value===null||value===undefined)return {kind:'blank'};
 const s=String(value);
 if(typeof value==='number'||/^-?\d+(\.\d+)?$/.test(s)){
  const n=Number(value);
  if(/^order no/i.test(header))return {kind:'number',value:n,format:'order'};
  if(/\(PHP\)/.test(header)||/\(PHP\)/.test(label))return {kind:'number',value:n,format:'money'};
  if(/change \(%\)/i.test(header))return {kind:'number',value:n,format:'pct'};
  return {kind:'number',value:n,format:Number.isInteger(n)?'int':''};
 }
 if(/^\d{4}-\d{2}-\d{2}$/.test(s))return {kind:'date',value:s};
 return {kind:'text',value:s};
}

export function xlsxBlob(report){
 const st=styleBook(),rows=[],merges=[],widths=[];let filter='',freeze=0;
 const width=Math.max(2,...report.sections.map(s=>s.columns.length));
 const fit=(c,len)=>{widths[c]=Math.max(widths[c]||0,len);};
 const put=(cells,height)=>{rows.push({cells,height});return rows.length;};
 const text=(v,look)=>({t:'s',v:String(v??''),s:st.xf(look)});

 // 1 · title block
 put([text('LexC’s Snacktime',{bold:true,size:18,color:PLUM})],30);
 put([text(report.title,{bold:true,size:14})],22);
 if(report.about)put([text(report.about,{italic:true,color:MUTED})]);
 put([]);
 // 2 · report details: label | value, bordered
 report.details.forEach(([label,value])=>{put([text(label,{bold:true,fill:'F6F1FB',border:'cell'}),text(value,{border:'cell',h:'left'})]);fit(0,String(label).length);});

 // 3 · tables
 report.sections.forEach(section=>{
  const cols=section.columns,n=cols.length;
  put([]);
  if(section.heading){const r=put([text(section.heading,{bold:true,size:12,color:'FFFFFF',fill:PLUM}),...Array.from({length:Math.max(n,2)-1},()=>text('',{fill:PLUM}))],22);merges.push('A'+r+':'+colName(Math.max(n,2)-1)+r);}
  const headRow=put(cols.map(c=>text(c,{bold:true,color:PLUM,fill:LILAC,border:'head',h:'center',wrap:true})),32);
  cols.forEach((c,i)=>fit(i,Math.min(String(c).length,16)));
  if(section.filter&&section.rows.length){filter='A'+headRow+':'+colName(n-1)+(headRow+section.rows.length);}
  if(!section.rows.length){put([text('No records for this period and these filters.',{italic:true,color:MUTED,border:'cell'}),...Array.from({length:n-1},()=>text('',{border:'cell'}))]);return;}
  const cellsFor=(row,total)=>{const cancelled=row.some(v=>/^cancelled$/i.test(String(v)));return row.map((value,i)=>{
   const header=cols[i]||'',k=kindOf(value,header,String(row[0]??'')),look={border:total?'total':'cell'};
   if(total){look.bold=true;look.fill=BLUSH;}
   if(k.kind==='number'){
    look.format=k.format||undefined;look.h=k.format==='order'?'center':'right';
    if(/balance/i.test(header)&&k.value>0&&!total&&!cancelled){look.bold=true;look.color=TONES.bad[1];}
    if(k.format==='pct'&&k.value){look.bold=true;look.color=k.value>0?TONES.good[1]:TONES.bad[1];}
    fit(i,k.format==='money'?String(Math.round(k.value)).length+6:String(value).length+(k.format==='order'?1:0));
    return {t:'n',v:k.value,s:st.xf(look)};
   }
   if(k.kind==='date'){look.format='date';look.h='center';fit(i,12);return {t:'n',v:serial(k.value),s:st.xf(look)};}
   if(k.kind==='blank')return {t:'s',v:'',s:st.xf(look)};
   const t=!total&&(/status/i.test(header)?tone(k.value):/change \(%\)/i.test(header)&&k.value==='New'?'good':'');
   if(t){look.bold=true;look.fill=TONES[t][0];look.color=TONES[t][1];look.h='center';}
   if(/^\d{1,2}:\d{2}/.test(k.value))look.h='center';
   if(i===0&&!total&&/^(measure|choice|product)/i.test(header))look.bold=true;
   fit(i,Math.min(k.value.length,46));
   return {t:'s',v:k.value,s:st.xf(look)};
  });};
  section.rows.forEach(r=>put(cellsFor(r,false)));
  if(section.totals)put(cellsFor(section.totals,true));
 });

 // 4 · notes
 if(report.notes?.length){put([]);put([text('Notes',{bold:true,color:PLUM})]);report.notes.forEach(note=>put([text('•  '+note,{italic:true,color:MUTED})]));}

 const sheetData=rows.map(({cells,height},r)=>'<row r="'+(r+1)+'"'+(height?' ht="'+height+'" customHeight="1"':'')+'>'+cells.map((c,i)=>{const ref=colName(i)+(r+1);
  return c.t==='n'?'<c r="'+ref+'" s="'+c.s+'"><v>'+c.v+'</v></c>':c.v===''?'<c r="'+ref+'" s="'+c.s+'"/>':'<c r="'+ref+'" s="'+c.s+'" t="inlineStr"><is><t xml:space="preserve">'+esc(c.v)+'</t></is></c>';}).join('')+'</row>').join('');
 const cols=Array.from({length:Math.max(width,widths.length)},(_,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+Math.max(11,Math.min(50,(widths[i]||8)+3))+'" customWidth="1"/>').join('');
 const view=freeze?'<sheetView workbookViewId="0" zoomScale="100"><pane ySplit="'+freeze+'" topLeftCell="A'+(freeze+1)+'" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A'+(freeze+1)+'" sqref="A'+(freeze+1)+'"/></sheetView>':'<sheetView workbookViewId="0" zoomScale="100"/>';
 const sheet='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
  '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:'+colName(Math.max(width,widths.length)-1)+rows.length+'"/><sheetViews>'+view+'</sheetViews><sheetFormatPr defaultRowHeight="18" customHeight="1"/><cols>'+cols+'</cols>'+
  '<sheetData>'+sheetData+'</sheetData>'+(filter?'<autoFilter ref="'+filter+'"/>':'')+(merges.length?'<mergeCells count="'+merges.length+'">'+merges.map(m=>'<mergeCell ref="'+m+'"/>').join('')+'</mergeCells>':'')+
  '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
 const name=(report.sheet||report.title).replace(/[\[\]:*?/\\]/g,' ').slice(0,31);
 const files={
  '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
  '_rels/.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
  'docProps/core.xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>'+esc('LexC’s Snacktime – '+report.title)+'</dc:title><dc:creator>LexC’s Snacktime</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">'+new Date().toISOString().slice(0,19)+'Z</dcterms:created></cp:coreProperties>',
  'xl/workbook.xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="'+esc(name)+'" sheetId="1" r:id="rId1"/></sheets>'+(filter?'<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\''+esc(name.replace(/'/g,"''"))+'\'!$'+filter.replace(/([A-Z]+)(\d+)/g,'$1$$$2').replace(':',':$')+'</definedName></definedNames>':'')+'</workbook>',
  'xl/_rels/workbook.xml.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml':sheet,
  'xl/styles.xml':st.xml()
 };
 return new Blob([zip(files)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

// ---- a plain (stored, uncompressed) zip: all an .xlsx needs
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc32=bytes=>{let c=0xFFFFFFFF;for(let i=0;i<bytes.length;i++)c=CRC[(c^bytes[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;};
function zip(files){
 const enc=new TextEncoder(),parts=[],central=[];let offset=0;
 const le=(n,size)=>{const b=new Uint8Array(size);for(let i=0;i<size;i++)b[i]=(n>>>(8*i))&255;return b;};
 for(const [name,text] of Object.entries(files)){
  const nameBytes=enc.encode(name),data=enc.encode(text),crc=crc32(data);
  const common=[le(20,2),le(0x0800,2),le(0,2),le(0,2),le(33,2),le(crc,4),le(data.length,4),le(data.length,4),le(nameBytes.length,2),le(0,2)];
  const local=[le(0x04034b50,4),...common,nameBytes,data];
  central.push([le(0x02014b50,4),le(20,2),...common,le(0,2),le(0,2),le(0,2),le(0,4),le(offset,4),nameBytes]);
  local.forEach(p=>{parts.push(p);offset+=p.length;});
 }
 const start=offset;central.flat().forEach(p=>{parts.push(p);offset+=p.length;});
 parts.push(le(0x06054b50,4),le(0,2),le(0,2),le(central.length,2),le(central.length,2),le(offset-start,4),le(start,4),le(0,2));
 const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;parts.forEach(p=>{out.set(p,at);at+=p.length;});return out;
}
