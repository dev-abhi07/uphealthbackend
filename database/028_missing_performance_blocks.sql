-- =============================================================================
-- Add 5 performance-table blocks missing from master (excel / outcome have them).
-- After this: active blocks = 902 (= Ind_value_rank Block sheet).
-- =============================================================================

INSERT INTO block (division_id, district_id, tehsil_id, state_id, lgd_code, name, is_active)
SELECT d.division_id,
       d.id,
       (
         SELECT b.tehsil_id
         FROM block b
         WHERE b.district_id = d.id AND b.tehsil_id IS NOT NULL
         LIMIT 1
       ),
       1,
       v.lgd_code,
       v.name,
       TRUE
FROM (
  VALUES
    ('640', '900072', 'Amethi DHQ'),
    ('178', '900075', 'Sant Kabir Nagar DHQ'),
    ('156', '900074', 'Kanpur Dehat (Urban)'),
    ('159', '900071', 'Lakhimpur Kheri DHQ'),
    ('661', '900073', 'Hapur (Urban)')
) AS v(district_lgd, lgd_code, name)
JOIN district d ON d.lgd_code::text = v.district_lgd
WHERE NOT EXISTS (
  SELECT 1 FROM block b WHERE b.lgd_code::text = v.lgd_code
);
