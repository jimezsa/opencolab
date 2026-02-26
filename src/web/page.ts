export function renderWebPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenColab Local Control</title>
    <style>
      :root {
        --bg: #f5f7f2;
        --ink: #1b1f23;
        --card: #ffffff;
        --line: #d7dfcf;
        --accent: #2e6d57;
        --muted: #5c6a65;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--ink);
        background: radial-gradient(circle at 20% 0%, #ecf5ea 0%, var(--bg) 35%, #eef1f9 100%);
      }
      header {
        padding: 20px;
        border-bottom: 1px solid var(--line);
        background: linear-gradient(135deg, #fefefb, #eef4e6);
      }
      main {
        padding: 20px;
        max-width: 1200px;
        margin: 0 auto;
        display: grid;
        gap: 16px;
        grid-template-columns: 360px 1fr;
      }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 14px;
      }
      h1 { margin: 0 0 6px; font-size: 24px; }
      h2 { margin: 0 0 12px; font-size: 18px; }
      .muted { color: var(--muted); font-size: 14px; }
      button {
        border: 1px solid var(--accent);
        background: var(--accent);
        color: white;
        border-radius: 8px;
        padding: 8px 10px;
        cursor: pointer;
      }
      button.ghost {
        background: transparent;
        color: var(--accent);
      }
      ul { margin: 0; padding-left: 18px; }
      li { margin: 6px 0; }
      code {
        background: #eef4e7;
        padding: 1px 4px;
        border-radius: 4px;
      }
      .row { display: flex; gap: 8px; flex-wrap: wrap; }
      @media (max-width: 900px) {
        main { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>OpenColab Local Control</h1>
      <div class="muted">Run monitoring, approvals, chats, meetings, and Telegram bridge logs.</div>
    </header>
    <main>
      <section class="card">
        <h2>Runs</h2>
        <div id="runs" class="muted">Loading...</div>
      </section>
      <section class="card">
        <h2>Details</h2>
        <div id="details" class="muted">Select a run from the left panel.</div>
      </section>
    </main>
    <script>
      const runsEl = document.getElementById('runs');
      const detailsEl = document.getElementById('details');

      async function fetchJson(url, init) {
        const r = await fetch(url, init);
        if (!r.ok) {
          throw new Error(await r.text());
        }
        return r.json();
      }

      async function loadRuns() {
        const runs = await fetchJson('/api/runs');
        if (!Array.isArray(runs) || runs.length === 0) {
          runsEl.innerHTML = '<div class="muted">No runs yet.</div>';
          return;
        }

        const list = document.createElement('ul');
        runs.forEach((run) => {
          const item = document.createElement('li');
          const button = document.createElement('button');
          button.className = 'ghost';
          button.textContent = run.run_id + ' [' + run.status + ']';
          button.onclick = () => loadRun(run.run_id);
          item.appendChild(button);
          list.appendChild(item);
        });

        runsEl.innerHTML = '';
        runsEl.appendChild(list);
      }

      async function postRunAction(runId, action) {
        await fetchJson('/api/runs/' + runId + '/' + action, { method: 'POST' });
        await loadRun(runId);
        await loadRuns();
      }

      async function loadRun(runId) {
        const status = await fetchJson('/api/runs/' + runId);
        const chats = await fetchJson('/api/runs/' + runId + '/chats');
        const meetings = await fetchJson('/api/runs/' + runId + '/meetings');

        detailsEl.innerHTML = '';
        const head = document.createElement('div');
        head.innerHTML = '<p><b>Run:</b> <code>' + runId + '</code></p>' +
          '<p><b>Status:</b> ' + status.run.status + '</p>' +
          '<p><b>Project:</b> ' + status.run.project_name + '</p>' +
          '<p><b>Goal:</b> ' + status.run.goal + '</p>';

        const actions = document.createElement('div');
        actions.className = 'row';

        const approveBtn = document.createElement('button');
        approveBtn.textContent = 'Approve';
        approveBtn.onclick = () => postRunAction(runId, 'approve');
        actions.appendChild(approveBtn);

        const pauseBtn = document.createElement('button');
        pauseBtn.className = 'ghost';
        pauseBtn.textContent = 'Pause';
        pauseBtn.onclick = () => postRunAction(runId, 'pause');
        actions.appendChild(pauseBtn);

        const stopBtn = document.createElement('button');
        stopBtn.className = 'ghost';
        stopBtn.textContent = 'Stop';
        stopBtn.onclick = () => postRunAction(runId, 'stop');
        actions.appendChild(stopBtn);

        const taskList = document.createElement('ul');
        (status.tasks || []).forEach((task) => {
          const li = document.createElement('li');
          li.textContent = task.task_id + ' :: ' + task.title + ' :: ' + task.status;
          taskList.appendChild(li);
        });

        const chatList = document.createElement('ul');
        chats.forEach((chat) => {
          const li = document.createElement('li');
          li.textContent = chat.chatId + ' [' + chat.kind + '] ' + chat.title;
          chatList.appendChild(li);
        });

        const meetingList = document.createElement('ul');
        meetings.forEach((meeting) => {
          const li = document.createElement('li');
          li.textContent = meeting.meetingId + ' [' + meeting.meetingType + ']';
          meetingList.appendChild(li);
        });

        detailsEl.appendChild(head);
        detailsEl.appendChild(actions);
        detailsEl.appendChild(document.createElement('hr'));
        detailsEl.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Tasks' }));
        detailsEl.appendChild(taskList);
        detailsEl.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Chats' }));
        detailsEl.appendChild(chatList);
        detailsEl.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Meetings' }));
        detailsEl.appendChild(meetingList);
      }

      loadRuns().catch((error) => {
        runsEl.textContent = error.message;
      });
    </script>
  </body>
</html>`;
}
