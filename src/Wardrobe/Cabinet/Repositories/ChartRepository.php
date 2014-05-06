<?php namespace Wardrobe\Cabinet\Repositories;

use Carbon\Carbon;
use Wardrobe\Cabinet\Entities\Post;

class ChartRepository {

	/**
	 * Get the total yearly posts
	 *
	 * @param null $year
	 * @return mixed
	 */
	public function yearlyTotalPosts($year = null)
	{
		$dt = Carbon::create($year, 1, 1, 1, 0, 0);

		$dates = array($dt->startOfMonth()->toDateTimeString(), $dt->endOfYear()->toDateTimeString());
		return Post::active()->whereBetween('publish_date', $dates)->count();
	}

	/**
	 * Get the words over time
	 *
	 * @param null $year
	 * @return mixed
	 */
	public function wordsOverTime($year = null)
	{
		$words['data'] = array();

		for ($i = 1; $i <= 12; $i++)
		{
			$dt = Carbon::create($year, $i, 1, 1, 0, 0);

			$label = $dt->format("M");
			$year = $dt->format("Y");

			$count_current = $this->generateWords($dt->startOfMonth()->toDateTimeString(), $dt->endOfMonth()->toDateTimeString());

			$count_past = $this->generateWords($dt->startOfMonth()->subYear()->toDateTimeString(), $dt->endOfMonth()->toDateTimeString());

			$words['data'][] = ['label' => $label, 'a' => $count_current, 'b' => $count_past];
			$words['labels'] = [$year, $dt->format("Y")];
		}

		return $words;
	}

	/**
	 * Get posts over time
	 *
	 * @param null $year
	 * @return array
	 */
	public function postsOverTime($year = null)
	{
		$posts = array();

		for ($i = 1; $i <= 12; $i++)
		{
			$dt = Carbon::create($year, $i, 1, 1, 0, 0);

			$label = $dt->format("M");
			$year = $dt->format("Y");

			$count_current = $this->generateQuery($dt->startOfMonth()->toDateTimeString(), $dt->endOfMonth()->toDateTimeString())->count();
			$count_past = $this->generateQuery($dt->startOfMonth()->subYear()->toDateTimeString(), $dt->endOfMonth()->toDateTimeString())->count();

			$posts['data'][] = ['label' => $label, 'a' => $count_current, 'b' => $count_past];
			$posts['labels'] = [$year, $dt->format("Y")];
		}

		return $posts;
	}

	/**
	 * Generate total words
	 *
	 * @param $after
	 * @param $before
	 * @return int|mixed
	 */
	protected function generateWords($after, $before)
	{
		$posts = $this->generateQuery($after, $before)->get();

		$count = 0;

		foreach ($posts as $post)
		{
			$count += str_word_count($post->content);
		}

		return $count;
	}

	/**
	 * Generate the scoped query
	 *
	 * @param $after
	 * @param $before
	 * @return mixed
	 */
	protected function generateQuery($after, $before)
	{
		return Post::active()->whereBetween('publish_date', array($after, $before));
	}

} 