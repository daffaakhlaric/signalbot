const fs = require('fs');
const html = fs.readFileSync('C:/Users/HP/Downloads/signalbot/sniper-view.html', 'utf8');
const scriptStart = html.indexOf('<script>') + '<script>'.length;
const scriptEnd = html.lastIndexOf('</script>');
const js = html.substring(scriptStart, scriptEnd);
try {
  new Function(js);
  console.log('JS syntax OK');
} catch(e) {
  // Try to find location
  const lines = js.split('\n');
  const errLine = parseInt(e.message.match(/line (\d+)/)?.[1] || '0');
  if (errLine > 0 && errLine <= lines.length) {
    const start = Math.max(0, errLine - 5);
    const end = Math.min(lines.length, errLine + 3);
    console.log('Error around line', errLine);
    for (let i = start; i < end; i++) {
      console.log((i+1) + ': ' + lines[i]);
    }
  } else {
    console.log('Error:', e.message);
  }
}
