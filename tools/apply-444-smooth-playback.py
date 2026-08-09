import re
from pathlib import Path

p = Path('solver/solver444UiActivation.js')
s = p.read_text()

s, n = re.subn(
    r'''  let moveIndex = 0;\n  let playbackTimer = 0;\n  let player = null;''',
    '''  let moveIndex = 0;\n  let playbackRaf = 0;\n  let playbackPlaying = false;\n  let playbackStartWallMs = 0;\n  let playbackStartTimelineMs = 0;\n  const PLAYBACK_TEMPO_SCALE = 1.7;\n  let player = null;''',
    s,
    count=1,
)
if n != 1:
    raise SystemExit(f'playback variable patch count={n}')

s, n = re.subn(
    r'''  function stopPlayback\(\) \{.*?\n  \}\n\n  function restoreHostChildren''',
    '''  function stopPlayback() {\n    if (playbackRaf) window.cancelAnimationFrame(playbackRaf);\n    playbackRaf = 0;\n    playbackPlaying = false;\n    solverPlayBtn.dataset.playing = "false";\n    solverPlayBtn.title = "자동 재생";\n    player?.pause?.();\n  }\n\n  function restoreHostChildren''',
    s,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit(f'stopPlayback patch count={n}')

old_player_config = '''      hintFacelets: "none",\n    });'''
new_player_config = '''      hintFacelets: "none",\n      experimentalSetupAnchor: "start",\n    });'''
if old_player_config not in s:
    raise SystemExit('player config anchor not found')
s = s.replace(old_player_config, new_player_config, 1)

pattern = r'''  function updateFrame\(\) \{.*?\n  \}\n\n  function clearOwnedStages'''
replacement = r'''  function moveDurationTimelineMs(move) {
    return String(move || "").includes("2") ? 1500 : 1000;
  }

  function timelineMsForMoveIndex(index) {
    let total = 0;
    const end = Math.max(0, Math.min(moves.length, Math.floor(Number(index) || 0)));
    for (let i = 0; i < end; i += 1) total += moveDurationTimelineMs(moves[i]);
    return total;
  }

  function moveIndexForTimelineMs(timestampMs) {
    const target = Math.max(0, Number(timestampMs) || 0);
    let total = 0;
    let index = 0;
    while (index < moves.length) {
      total += moveDurationTimelineMs(moves[index]);
      if (target < total) break;
      index += 1;
    }
    return index;
  }

  function updatePlaybackControlsOnly() {
    solverStepLabel.textContent = `${moveIndex}/${moves.length} 수`;
    solverStepResetBtn.disabled = moveIndex === 0;
    solverStepPrevBtn.disabled = moveIndex === 0;
    solverStepNextBtn.disabled = moveIndex >= moves.length;
    solverPlayBtn.disabled = moves.length === 0;
  }

  function loadFullPlaybackTimeline() {
    if (!player) return;
    player.experimentalSetupAlg = playerScramble;
    player.alg = solution;
    player.tempoScale = PLAYBACK_TEMPO_SCALE;
  }

  function updateFrame() {
    if (!player) return;
    loadFullPlaybackTimeline();
    player.timestamp = timelineMsForMoveIndex(moveIndex);
    player.pause();
    updatePlaybackControlsOnly();
  }

  function setMoveIndex(nextIndex) {
    moveIndex = Math.max(0, Math.min(moves.length, Math.floor(Number(nextIndex) || 0)));
    updateFrame();
    if (moveIndex >= moves.length) stopPlayback();
  }

  function tickPlayback(now) {
    if (!playbackPlaying || !player || !is444()) {
      stopPlayback();
      return;
    }
    const timelineMs = playbackStartTimelineMs
      + Math.max(0, now - playbackStartWallMs) * PLAYBACK_TEMPO_SCALE;
    const nextIndex = moveIndexForTimelineMs(timelineMs);
    if (nextIndex !== moveIndex) {
      moveIndex = nextIndex;
      updatePlaybackControlsOnly();
    }
    if (moveIndex >= moves.length) {
      moveIndex = moves.length;
      updatePlaybackControlsOnly();
      stopPlayback();
      return;
    }
    playbackRaf = window.requestAnimationFrame(tickPlayback);
  }

  function togglePlayback() {
    if (!ownsPlayback()) return;
    if (playbackPlaying) {
      stopPlayback();
      updatePlaybackControlsOnly();
      return;
    }
    if (moveIndex >= moves.length) moveIndex = 0;
    loadFullPlaybackTimeline();
    const startTimeline = timelineMsForMoveIndex(moveIndex);
    player.timestamp = startTimeline;
    player.tempoScale = PLAYBACK_TEMPO_SCALE;
    playbackStartTimelineMs = startTimeline;
    playbackStartWallMs = performance.now();
    playbackPlaying = true;
    solverPlayBtn.dataset.playing = "true";
    solverPlayBtn.title = "정지";
    updatePlaybackControlsOnly();
    player.play({ autoSkipToOtherEndIfStartingAtBoundary: false });
    playbackRaf = window.requestAnimationFrame(tickPlayback);
  }

  function clearOwnedStages'''
s2, n = re.subn(pattern, replacement, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit(f'playback function patch count={n}')
s = s2

if 'window.setInterval(() =>' in s:
    raise SystemExit('legacy interval playback still present')
if 'player.alg = joinMoves(moves.slice(0, moveIndex))' in s:
    raise SystemExit('legacy per-step alg rebuild still present')
if 'player.alg = solution;' not in s:
    raise SystemExit('full solution timeline missing')
if 'window.requestAnimationFrame(tickPlayback)' not in s:
    raise SystemExit('requestAnimationFrame playback missing')

p.write_text(s)
