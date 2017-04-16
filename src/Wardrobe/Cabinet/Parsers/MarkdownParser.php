<?php namespace Wardrobe\Cabinet\Parsers;

use \Michelf\MarkdownExtra as Markdown;

class MarkdownParser implements ParserInterface {

	protected $markdown;

	public function __construct(Markdown $markdown)
	{
		$this->markdown = $markdown;
	}

	/**
	 * Convert a string to markdown.
	 *
	 * @param $str
	 * @return mixed
	 */
	public function parse($str)
	{
		if (\Config::get('wardrobe.auto_replace_twitter_links'))
		{
			$str = $this->replaceTwitterLinks($str);
		}

		return $this->markdown->defaultTransform($str);
	}

	/**
	 * Replace Twitter links in string
	 * @param  $str
	 * @return string
	 */
	public function replaceTwitterLinks($str)
	{
		preg_match_all("/@(\w+)/", $str, $matches);

		if (count($matches))
		{
			foreach ($matches[0] as $index => $html) {
				$str = str_replace($html, '<a href="http://www.twitter.com/'.$matches[1][$index].'" target="_blank">'.$html.'</a>', $str);
			}
		}

		return $str;
	}
	
}
