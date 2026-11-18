// Render the real shell (as doGet would) for a student, pinned to a release; print the HTML.
const { makeServer } = require('./sim');
const server = makeServer();
server.useRelease(process.argv[2]);
server.setEmail(process.argv[3] || 'sri.student@excelcenteraz.org');
process.stdout.write(server.renderIndex(require('path').join(__dirname, '../apps-script/Index.html')));
