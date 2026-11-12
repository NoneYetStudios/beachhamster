<?php
/* GET api/leaderboard.php  ->  top 25 scores as JSON. */
require __DIR__ . '/db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET' && $_SERVER['REQUEST_METHOD'] !== 'HEAD') {
    header('Allow: GET, HEAD');
    bh_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

$limit = BH_BOARD_SIZE;
if (isset($_GET['limit']) && ctype_digit((string) $_GET['limit'])) {
    $limit = max(1, min(BH_BOARD_SIZE, (int) $_GET['limit']));
}

try {
    $pdo = bh_db();
    $st = $pdo->prepare(
        'SELECT player_name, score, sand_dollars, survival_time, created_at
         FROM scores
         ORDER BY score DESC, survival_time DESC, sand_dollars DESC, created_at ASC
         LIMIT :n'
    );
    $st->bindValue(':n', $limit, PDO::PARAM_INT);
    $st->execute();
    $entries = [];
    $rank = 1;
    foreach ($st->fetchAll() as $row) {
        $entries[] = [
            'rank' => $rank++,
            'player_name' => $row['player_name'],
            'score' => (int) $row['score'],
            'sand_dollars' => (int) $row['sand_dollars'],
            'survival_time' => (int) $row['survival_time'],
            'created_at' => (int) $row['created_at'],
        ];
    }
    bh_json(['ok' => true, 'entries' => $entries]);
} catch (Throwable $e) {
    bh_json(['ok' => false, 'error' => 'Could not read the leaderboard.'], 500);
}
