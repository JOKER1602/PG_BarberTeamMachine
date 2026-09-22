import { Router } from 'express';
import pool from '../config/database.js';

const router = Router();

router.get('/', async (_request, response, next) => {
  try {
    const [[summary]] = await pool.execute(
      `SELECT COUNT(*) AS total, COALESCE(ROUND(AVG(rating), 1), 0) AS average,
       COALESCE(SUM(rating = 5), 0) AS five, COALESCE(SUM(rating = 4), 0) AS four,
       COALESCE(SUM(rating = 3), 0) AS three, COALESCE(SUM(rating = 2), 0) AS two, COALESCE(SUM(rating = 1), 0) AS one
       FROM reviews WHERE is_visible = TRUE`
    );
    const [reviews] = await pool.execute(
      `SELECT r.id, r.rating, r.comment, r.created_at AS createdAt,
       CONCAT(u.first_name, ' ', LEFT(u.last_name, 1), '.') AS clientName,
       b.display_name AS barberName
       FROM reviews r JOIN users u ON u.id = r.client_id
       LEFT JOIN barbers b ON b.id = r.barber_id
       WHERE r.is_visible = TRUE ORDER BY r.created_at DESC LIMIT 6`
    );
    return response.json({ summary, reviews });
  } catch (error) { return next(error); }
});

export default router;
