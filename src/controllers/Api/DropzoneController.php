<?php namespace Wardrobe\Cabinet\Controllers\Api;

use Controller;
use Input, Config, Response, Exception, File;
use Symfony\Component\Yaml\Parser;
use Intervention\Image\Image;

class DropzoneController extends Controller {

	/**
	 * Create a new API Dropzone controller.
	 *
	 * @return \Wardrobe\Cabinet\Controllers\Api\DropzoneController
	 */
	public function __construct()
	{
		$this->beforeFilter('wardrobe.auth');
	}

	/**
	 * Display a listing of the resource.
	 *
	 * @throws Exception
	 * @return Response
	 */
	public function postIndex()
	{
		if ( ! Input::hasFile('file'))
		{
			return Response::json(array('error' => 'File is required'), 400);
		}

		$contents = trim(File::get(Input::file('file')->getRealPath()));

		if (substr($contents, 0, 3) !== '---')
		{
			throw new Exception('Bad Markdown Formatting');
		}

		if ( ! ($pos = strpos($contents, '---', 3)))
		{
			throw new Exception('Bad Markdown Formatting');
		}

		$frontMatter = trim(substr($contents, 3, $pos - 3));
		$contents = trim(substr($contents, $pos + 3));

		$yaml = new Parser();

		$fields = $yaml->parse($frontMatter);

		return Response::json(array(
			'fields' => $fields,
			'content' => $contents
		));
	}

	/**
	 * Post an image from the admin
	 *
	 * @return Json
	 */
	public function postImage()
	{
		$file = Input::file('file');
		$imageDir = Config::get('wardrobe.image_dir', 'img');
		$destinationPath = public_path(). "/" . $imageDir ."/";
		$filename = $file->getClientOriginalName();
		$resizeEnabled = Config::get('wardrobe.image_resize.enabled', false);
		
		if ($resizeEnabled)
		{
			$resizeWidth = Config::get('wardrobe.image_resize.width');
			$resizeHeight = Config::get('wardrobe.image_resize.height');
			$image = Image::make($file->getRealPath())->resize($resizeWidth, $resizeHeight, true);
			$image->save($destinationPath.$filename);
		}
		else
		{
			$file->move($destinationPath, $filename);
		}

		if (File::exists($destinationPath.$filename))
		{
			return Response::json(array('filename' => "/{$imageDir}/".$filename));
		}
		return Response::json(array('error' => 'Upload failed. Please ensure your public/'.$imageDir.' directory is writable.'));
	}
}
