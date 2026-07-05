alter table public.meld_cards
  add column wild_as_rank text null;

comment on column public.meld_cards.wild_as_rank is
  'For a wild card (JOKER or the hand''s wild rank) that is part of a RUN meld: which rank it stands in for, so the run can be stored/displayed in sequence. Null for non-wild cards, cards in a SET meld, or a wild not yet assigned.';
