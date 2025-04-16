CREATE TEMPORARY TABLE /*_*/__temp__change_tag AS SELECT ct_id, ct_rc_id, ct_log_id, ct_rev_id, ct_params, ct_tag_id FROM /*_*/change_tag;
DROP TABLE /*_*/change_tag;
CREATE TABLE /*_*/change_tag (ct_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, ct_rc_id INTEGER UNSIGNED DEFAULT NULL, ct_log_id INTEGER UNSIGNED DEFAULT NULL, ct_rev_id INTEGER UNSIGNED DEFAULT NULL, ct_params BLOB DEFAULT NULL, ct_tag_id INTEGER UNSIGNED NOT NULL);
INSERT INTO /*_*/change_tag (ct_id, ct_rc_id, ct_log_id, ct_rev_id, ct_params, ct_tag_id) SELECT ct_id, ct_rc_id, ct_log_id, ct_rev_id, ct_params, ct_tag_id FROM /*_*/__temp__change_tag;
DROP TABLE /*_*/__temp__change_tag;
CREATE UNIQUE INDEX change_tag_rc_tag_id ON /*_*/change_tag (ct_rc_id, ct_tag_id);
CREATE UNIQUE INDEX change_tag_log_tag_id ON /*_*/change_tag (ct_log_id, ct_tag_id);
CREATE UNIQUE INDEX change_tag_rev_tag_id ON /*_*/change_tag (ct_rev_id, ct_tag_id);
CREATE INDEX change_tag_tag_id_id ON /*_*/change_tag (ct_tag_id, ct_rc_id, ct_rev_id, ct_log_id);
