<?php
/* POST api/submit_score.php
 * Body: {"player_name": "...", "score": 1234, "sand_dollars": 18, "survival_time": 87}
 *
 * Duplicate handling: one row per player name (case-insensitive). A new submission only
 * replaces the stored row if the score is higher (or equal score with better time/shells).
 */
require __DIR__ . '/db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    bh_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

$raw = file_get_contents('php://input', false, null, 0, 4096);
$in = [];
if ($raw !== false && $raw !== '') {
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) {
        $in = $decoded;
    }
}
if (!$in && !empty($_POST)) {
    $in = $_POST;
}

/* ---- Validation ---- */
$rawName = $in['player_name'] ?? ($in['name'] ?? null);
$playerName = is_string($rawName) ? trim(preg_replace('/\s+/', ' ', $rawName)) : '';
if ($playerName === '' || strlen($playerName) > 12 || !preg_match('/^[A-Za-z0-9 _.\-!?]+$/', $playerName)) {
    bh_json(['ok' => false, 'error' => 'Name must be 1-12 characters: letters, numbers, spaces and _ . - ! ?'], 422);
}

function bh_int($v): ?int
{
    if (is_int($v)) {
        return $v;
    }
    if (is_string($v) && preg_match('/^\d{1,9}$/', $v)) {
        return (int) $v;
    }
    if (is_float($v) && $v >= 0 && $v < 1e9 && floor($v) == $v) {
        return (int) $v;
    }
    return null;
}

$score = bh_int($in['score'] ?? null);
$sandDollars = bh_int($in['sand_dollars'] ?? null);
$survivalTime = bh_int($in['survival_time'] ?? ($in['time'] ?? null));

if ($score === null || $sandDollars === null || $survivalTime === null) {
    bh_json(['ok' => false, 'error' => 'Score, sand dollars, and survival time must be whole numbers.'], 422);
}
if ($score < 0 || $score > 5000000 || $sandDollars < 0 || $sandDollars > 100000 || $survivalTime < 1 || $survivalTime > 86400) {
    bh_json(['ok' => false, 'error' => 'Score, sand dollars, or survival time out of range.'], 422);
}
// Plausibility: survival gives 5 pts/s; pickups give 10, 25, 100, or 150 pts (Sea Star)
// stacked with up to 2x Surf Bonus and 3x Beachcomber Chain = up to 900 pts per pickup.
if ($sandDollars > $survivalTime * 12 + 25) {
    bh_json(['ok' => false, 'error' => 'Shell count implausible for survival time.'], 422);
}
if ($score > $survivalTime * 25 + $sandDollars * 950 + 1000) {
    bh_json(['ok' => false, 'error' => 'Score failed plausibility validation.'], 422);
}

$nameKey = strtolower($playerName);
$now = time();

try {
    $pdo = bh_db();

    /* ---- Rate limit per IP ---- */
    $ipHash = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? 'unknown') . '|beachhamster');
    $pdo->exec('DELETE FROM rate_limit WHERE last_submit < ' . ($now - 3600));
    $st = $pdo->prepare('SELECT last_submit FROM rate_limit WHERE ip_hash = :h');
    $st->execute([':h' => $ipHash]);
    $last = $st->fetchColumn();
    if ($last !== false && ($now - (int) $last) < BH_MIN_SUBMIT_GAP) {
        bh_json(['ok' => false, 'error' => 'Slow down! Please wait a few seconds between submissions.'], 429);
    }

    $pdo->beginTransaction();
    $pdo->prepare('INSERT OR REPLACE INTO rate_limit (ip_hash, last_submit) VALUES (:h, :t)')
        ->execute([':h' => $ipHash, ':t' => $now]);

    $st = $pdo->prepare('SELECT id, player_name, score, sand_dollars, survival_time, created_at FROM scores WHERE name_key = :k');
    $st->execute([':k' => $nameKey]);
    $existing = $st->fetch();

    if (!$existing) {
        $pdo->prepare(
            'INSERT INTO scores (player_name, name_key, score, sand_dollars, survival_time, created_at)
             VALUES (:n, :k, :s, :d, :t, :c)'
        )->execute([
            ':n' => $playerName,
            ':k' => $nameKey,
            ':s' => $score,
            ':d' => $sandDollars,
            ':t' => $survivalTime,
            ':c' => $now,
        ]);
        $status = 'new';
        $best = [$playerName, $score, $sandDollars, $survivalTime, $now];
    } elseif (
        $score > (int) $existing['score'] ||
        ($score === (int) $existing['score'] && $survivalTime > (int) $existing['survival_time'])
    ) {
        $pdo->prepare(
            'UPDATE scores
             SET player_name = :n, score = :s, sand_dollars = :d, survival_time = :t, created_at = :c
             WHERE id = :id'
        )->execute([
            ':n' => $playerName,
            ':s' => $score,
            ':d' => $sandDollars,
            ':t' => $survivalTime,
            ':c' => $now,
            ':id' => $existing['id'],
        ]);
        $status = 'improved';
        $best = [$playerName, $score, $sandDollars, $survivalTime, $now];
    } else {
        $status = (
            $score === (int) $existing['score'] &&
            $sandDollars === (int) $existing['sand_dollars'] &&
            $survivalTime === (int) $existing['survival_time']
        ) ? 'duplicate' : 'not_improved';
        $best = [
            $existing['player_name'],
            (int) $existing['score'],
            (int) $existing['sand_dollars'],
            (int) $existing['survival_time'],
            (int) $existing['created_at'],
        ];
    }

    // Keep the table bounded: retain only the top rows.
    $pdo->exec(
        'DELETE FROM scores WHERE id NOT IN (
            SELECT id FROM scores
            ORDER BY score DESC, survival_time DESC, sand_dollars DESC, created_at ASC
            LIMIT ' . BH_MAX_ROWS . '
        )'
    );
    $pdo->commit();

    $rank = bh_rank($pdo, $best[1], $best[3], $best[2], $best[4]);
    bh_json([
        'ok' => true,
        'status' => $status,
        'rank' => $rank,
        'best' => [
            'player_name' => $best[0],
            'score' => $best[1],
            'sand_dollars' => $best[2],
            'survival_time' => $best[3],
        ],
    ]);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    bh_json(['ok' => false, 'error' => 'Could not save your score. Please try again.'], 500);
}
