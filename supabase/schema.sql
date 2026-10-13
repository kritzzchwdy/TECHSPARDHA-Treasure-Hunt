-- TECHSPARDHA 2K26 Treasure Hunt schema
-- Run in Supabase SQL Editor. Review before production use.

create extension if not exists pgcrypto;

create type public.app_role as enum ('team', 'admin');
create type public.attempt_status as enum ('not_started', 'active', 'completed', 'disqualified');

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  team_code text not null unique,
  created_at timestamptz not null default now(),
  is_active boolean not null default true
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'team',
  team_id uuid unique references public.teams(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  round_no int not null check (round_no between 1 and 4),
  sequence_no int not null default 1,
  prompt text not null,
  options jsonb not null default '[]'::jsonb,
  answer_key text not null,
  points int not null default 10 check (points >= 0),
  checkpoint_label text not null default 'Checkpoint',
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  unique(round_no, sequence_no)
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null unique references public.teams(id) on delete cascade,
  status public.attempt_status not null default 'not_started',
  started_at timestamptz,
  finished_at timestamptz,
  current_round int not null default 1 check (current_round between 1 and 4),
  current_sequence int not null default 1,
  total_score int not null default 0,
  last_answer_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.answer_submissions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  submitted_answer text not null,
  is_correct boolean not null,
  points_awarded int not null default 0,
  submitted_at timestamptz not null default now()
);

create table public.qualifications (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  round_no int not null check (round_no between 1 and 4),
  qualified boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique(team_id, round_no)
);

create index questions_round_idx on public.questions(round_no, sequence_no) where is_published;
create index answers_attempt_idx on public.answer_submissions(attempt_id, submitted_at);
create index attempts_status_idx on public.attempts(status);

-- Create a profile for every new auth user. Team assignment is intentionally admin-controlled.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(id, role)
  values (new.id, 'team')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.my_team_id()
returns uuid language sql stable security definer set search_path = public
as $$
  select team_id from public.profiles where id = auth.uid();
$$;

alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.questions enable row level security;
alter table public.attempts enable row level security;
alter table public.answer_submissions enable row level security;
alter table public.qualifications enable row level security;

-- Teams can only see their own team record. Admins can see all.
create policy "team reads own team or admin all" on public.teams for select
using (public.is_admin() or id = public.my_team_id());
create policy "admin manages teams" on public.teams for all
using (public.is_admin()) with check (public.is_admin());

create policy "profile self or admin read" on public.profiles for select
using (id = auth.uid() or public.is_admin());
create policy "admin updates profiles" on public.profiles for update
using (public.is_admin()) with check (public.is_admin());

-- Published questions expose prompts/options only through the team-safe RPC below.
-- Direct table reads are admin-only so answer_key is never exposed.
create policy "admin manages questions" on public.questions for all
using (public.is_admin()) with check (public.is_admin());

create policy "attempt owner or admin reads" on public.attempts for select
using (public.is_admin() or team_id = public.my_team_id());
create policy "admin manages attempts" on public.attempts for all
using (public.is_admin()) with check (public.is_admin());

create policy "submission owner or admin reads" on public.answer_submissions for select
using (public.is_admin() or exists(select 1 from public.attempts a where a.id=attempt_id and a.team_id=public.my_team_id()));
create policy "admin manages submissions" on public.answer_submissions for all
using (public.is_admin()) with check (public.is_admin());

create policy "qualification own or admin reads" on public.qualifications for select
using (public.is_admin() or team_id = public.my_team_id());
create policy "admin manages qualifications" on public.qualifications for all
using (public.is_admin()) with check (public.is_admin());

-- Keep user-facing privileges narrow. RPC functions perform validated writes.
revoke all on public.questions from anon, authenticated;
grant select, insert, update, delete on public.questions to authenticated;
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant select on public.teams, public.attempts, public.answer_submissions, public.qualifications to authenticated;

-- Returns only safe question fields; never returns answer_key.
create or replace function public.safe_question(p_round int, p_sequence int)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', q.id, 'round_no', q.round_no, 'sequence_no', q.sequence_no,
    'prompt', q.prompt, 'options', q.options, 'points', q.points,
    'checkpoint_label', q.checkpoint_label
  )
  from public.questions q
  where q.round_no=p_round and q.sequence_no=p_sequence and q.is_published
  limit 1;
$$;

create or replace function public.get_my_game_state()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_team uuid; v_attempt public.attempts%rowtype; v_question jsonb;
begin
  select team_id into v_team from public.profiles where id=auth.uid();
  if v_team is null then raise exception 'Your account is not assigned to a team. Ask the coordinator.'; end if;
  select * into v_attempt from public.attempts where team_id=v_team;
  if not found then
    return jsonb_build_object('attempt', null, 'question', null);
  end if;
  if v_attempt.status='active' then
    v_question := public.safe_question(v_attempt.current_round, v_attempt.current_sequence);
  end if;
  return jsonb_build_object(
    'attempt', jsonb_build_object('id',v_attempt.id,'team_id',v_attempt.team_id,'status',v_attempt.status,
      'started_at',v_attempt.started_at,'finished_at',v_attempt.finished_at,'current_round',v_attempt.current_round,
      'current_sequence',v_attempt.current_sequence,'total_score',v_attempt.total_score),
    'question', v_question
  );
end;
$$;

create or replace function public.start_my_attempt()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_team uuid; v_attempt public.attempts%rowtype; v_q jsonb;
begin
  select team_id into v_team from public.profiles where id=auth.uid();
  if v_team is null then raise exception 'Your account is not assigned to a team.'; end if;
  if not exists(select 1 from public.teams where id=v_team and is_active) then raise exception 'Team is inactive.'; end if;
  if not exists(select 1 from public.questions where round_no=1 and sequence_no=1 and is_published) then
    raise exception 'Coordinator has not published the first question yet.';
  end if;
  insert into public.attempts(team_id,status,started_at,current_round,current_sequence)
  values(v_team,'active',now(),1,1)
  on conflict(team_id) do nothing;
  select * into v_attempt from public.attempts where team_id=v_team for update;
  if v_attempt.status='disqualified' then raise exception 'This team has been disqualified.'; end if;
  if v_attempt.status='completed' then raise exception 'This attempt is already completed.'; end if;
  if v_attempt.started_at is null then
    update public.attempts set status='active',started_at=now(),updated_at=now() where id=v_attempt.id returning * into v_attempt;
  end if;
  v_q := public.safe_question(v_attempt.current_round,v_attempt.current_sequence);
  return jsonb_build_object('attempt',jsonb_build_object('id',v_attempt.id,'status',v_attempt.status,
    'started_at',v_attempt.started_at,'current_round',v_attempt.current_round,'current_sequence',v_attempt.current_sequence,
    'total_score',v_attempt.total_score),'question',v_q);
end;
$$;

create or replace function public.submit_my_answer(p_answer text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_team uuid; v_attempt public.attempts%rowtype; v_q public.questions%rowtype;
  v_correct boolean; v_next_round int; v_next_seq int; v_next jsonb; v_award int:=0;
begin
  select team_id into v_team from public.profiles where id=auth.uid();
  if v_team is null then raise exception 'No team assigned.'; end if;
  select * into v_attempt from public.attempts where team_id=v_team for update;
  if not found or v_attempt.status <> 'active' then raise exception 'No active attempt.'; end if;
  select * into v_q from public.questions
    where round_no=v_attempt.current_round and sequence_no=v_attempt.current_sequence and is_published;
  if not found then raise exception 'No active published question. Contact coordinator.'; end if;

  v_correct := lower(trim(coalesce(p_answer,''))) = lower(trim(v_q.answer_key));
  insert into public.answer_submissions(attempt_id,question_id,submitted_answer,is_correct,points_awarded)
  values(v_attempt.id,v_q.id,left(coalesce(p_answer,''),500),v_correct,case when v_correct then v_q.points else 0 end);

  if not v_correct then
    update public.attempts set last_answer_at=now(),updated_at=now() where id=v_attempt.id;
    return jsonb_build_object('correct',false,'message','Not correct. Try again.','score',v_attempt.total_score);
  end if;

  v_award := v_q.points;
  v_next_round := v_attempt.current_round;
  v_next_seq := v_attempt.current_sequence + 1;
  if not exists(select 1 from public.questions where round_no=v_next_round and sequence_no=v_next_seq and is_published) then
    if v_next_round < 4 then
      -- Advancement to the next round requires admin qualification.
      if exists(select 1 from public.qualifications where team_id=v_team and round_no=v_next_round and qualified) then
        v_next_round := v_next_round + 1;
        v_next_seq := 1;
      else
        update public.attempts set total_score=total_score+v_award,last_answer_at=now(),updated_at=now() where id=v_attempt.id;
        return jsonb_build_object('correct',true,'message','Correct! Round complete. Wait for coordinator qualification.','score',v_attempt.total_score+v_award,'round_complete',true);
      end if;
    else
      update public.attempts set total_score=total_score+v_award,status='completed',finished_at=now(),last_answer_at=now(),updated_at=now() where id=v_attempt.id;
      return jsonb_build_object('correct',true,'message','Correct! Hunt completed. Report to coordinator.','score',v_attempt.total_score+v_award,'completed',true);
    end if;
  end if;

  if not exists(select 1 from public.questions where round_no=v_next_round and sequence_no=v_next_seq and is_published) then
    update public.attempts set total_score=total_score+v_award,last_answer_at=now(),updated_at=now() where id=v_attempt.id;
    return jsonb_build_object('correct',true,'message','Correct! Waiting for the next published question.','score',v_attempt.total_score+v_award);
  end if;

  update public.attempts set current_round=v_next_round,current_sequence=v_next_seq,total_score=total_score+v_award,last_answer_at=now(),updated_at=now()
  where id=v_attempt.id;
  v_next := public.safe_question(v_next_round,v_next_seq);
  return jsonb_build_object('correct',true,'message','Correct! Next question unlocked.','score',v_attempt.total_score+v_award,'question',v_next);
end;
$$;

create or replace function public.admin_create_team(p_name text, p_code text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin only.'; end if;
  if length(trim(coalesce(p_name,''))) < 2 or length(trim(coalesce(p_code,''))) < 2 then raise exception 'Team name and code are required.'; end if;
  insert into public.teams(name,team_code) values(trim(p_name),upper(trim(p_code))) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_add_question(p_round_no int,p_prompt text,p_options jsonb,p_answer text,p_points int,p_checkpoint_label text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_seq int;
begin
  if not public.is_admin() then raise exception 'Admin only.'; end if;
  if p_round_no not between 1 and 4 then raise exception 'Round must be 1 to 4.'; end if;
  if length(trim(coalesce(p_prompt,''))) < 5 then raise exception 'Question is too short.'; end if;
  select coalesce(max(sequence_no),0)+1 into v_seq from public.questions where round_no=p_round_no;
  insert into public.questions(round_no,sequence_no,prompt,options,answer_key,points,checkpoint_label,is_published)
  values(p_round_no,v_seq,trim(p_prompt),coalesce(p_options,'[]'::jsonb),trim(p_answer),greatest(p_points,0),coalesce(nullif(trim(p_checkpoint_label),''),'Checkpoint'),false)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_publish_question(p_question_id uuid,p_published boolean)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin only.'; end if;
  update public.questions set is_published=p_published where id=p_question_id;
  return found;
end;
$$;

create or replace function public.admin_set_qualification(p_team_id uuid,p_round_no int,p_qualified boolean)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin only.'; end if;
  if p_round_no not between 1 and 4 then raise exception 'Round must be 1 to 4.'; end if;
  insert into public.qualifications(team_id,round_no,qualified,updated_by,updated_at)
  values(p_team_id,p_round_no,p_qualified,auth.uid(),now())
  on conflict(team_id,round_no) do update set qualified=excluded.qualified,updated_by=auth.uid(),updated_at=now();
  return true;
end;
$$;

-- Admin-only overview view, exposed through security-invoker semantics plus RLS on source tables.
create or replace view public.admin_attempt_overview as
select t.id as team_id,t.name as team_name,t.team_code,a.status,a.started_at,a.finished_at,
  a.current_round,a.current_sequence,a.total_score,
  case when a.started_at is not null then floor(extract(epoch from (coalesce(a.finished_at,now())-a.started_at)))::int else null end as elapsed_seconds
from public.teams t left join public.attempts a on a.team_id=t.id
where public.is_admin();

grant execute on function public.get_my_game_state() to authenticated;
grant execute on function public.start_my_attempt() to authenticated;
grant execute on function public.submit_my_answer(text) to authenticated;
grant execute on function public.admin_create_team(text,text) to authenticated;
grant execute on function public.admin_add_question(int,text,jsonb,text,int,text) to authenticated;
grant execute on function public.admin_publish_question(uuid,boolean) to authenticated;
grant execute on function public.admin_set_qualification(uuid,int,boolean) to authenticated;
grant execute on function public.safe_question(int,int) to authenticated;
grant select on public.admin_attempt_overview to authenticated;

-- Security hardening: do not allow unauthenticated RPC calls.
revoke all on function public.get_my_game_state() from public, anon;
revoke all on function public.start_my_attempt() from public, anon;
revoke all on function public.submit_my_answer(text) from public, anon;
revoke all on function public.admin_create_team(text,text) from public, anon;
revoke all on function public.admin_add_question(int,text,jsonb,text,int,text) from public, anon;
revoke all on function public.admin_publish_question(uuid,boolean) from public, anon;
revoke all on function public.admin_set_qualification(uuid,int,boolean) from public, anon;
revoke all on function public.safe_question(int,int) from public, anon;
grant execute on function public.get_my_game_state() to authenticated;
grant execute on function public.start_my_attempt() to authenticated;
grant execute on function public.submit_my_answer(text) to authenticated;
grant execute on function public.admin_create_team(text,text) to authenticated;
grant execute on function public.admin_add_question(int,text,jsonb,text,int,text) to authenticated;
grant execute on function public.admin_publish_question(uuid,boolean) to authenticated;
grant execute on function public.admin_set_qualification(uuid,int,boolean) to authenticated;
grant execute on function public.safe_question(int,int) to authenticated;
